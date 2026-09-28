/*
 * 雲端同步：
 * - 每次修改後（稍作合併）以交易寫入 app/main，rev 不符代表別人剛改過 → 載入最新資料
 * - 即時接收其他管理員的修改
 * - 儲存成功後，把有變動的分校展示資料發布到 branchViews
 */
(function (root) {
  'use strict';
  const C = root.Core;
  const S = root.Store;
  const SIZE_WARN = 800 * 1024; // Firestore 單一文件上限 1MB

  const Sync = {
    cloud: null,
    rev: 0,
    seq: 0,        // 本機修改次數
    savedSeq: 0,   // 已存到雲端的修改次數
    saving: false,
    timer: null,
    status: 'idle',
    error: '',
    published: {},
    onStatus: null,

    setStatus(status, error) {
      this.status = status;
      this.error = error || '';
      if (this.onStatus) this.onStatus(status, this.error);
    },

    /** 開始同步；第一次收到雲端資料後呼叫 onReady */
    start(cloud, onReady, onDenied) {
      this.cloud = cloud;
      let first = true;
      S.persistHook = () => this.schedule();
      return cloud.watchMain((doc) => {
        if (first) {
          first = false;
          if (doc) {
            this.rev = doc.rev || 0;
            S.setFromRemote(JSON.parse(doc.json));
          } else {
            this.rev = 0;
            S.data = S.normalize(this.initialData());
            this.seq += 1;
            this.push();
          }
          this.setStatus('saved');
          onReady();
          return;
        }
        if (!doc || (doc.rev || 0) <= this.rev) return;
        if (this.saving || this.seq !== this.savedSeq) return; // 自己正在存，交給交易判斷
        this.rev = doc.rev;
        S.setFromRemote(JSON.parse(doc.json));
        if (doc.updatedBy) root.dispatchEvent(new CustomEvent('hsm-remote-update', { detail: doc.updatedBy }));
      }, (e) => {
        if (first && e && e.code === 'permission-denied') onDenied();
        else this.setStatus('error', e && e.message);
      });
    },

    /** 雲端尚無資料：若這台電腦有舊的本機資料，詢問是否上傳 */
    initialData() {
      const raw = S.localRaw();
      if (raw && confirm('雲端目前沒有資料。\n\n偵測到這台電腦有之前的本機資料，要上傳到雲端嗎？\n（選「取消」會建立空白資料）')) {
        try { return JSON.parse(raw); } catch (e) { /* ignore */ }
      }
      return {};
    },

    schedule() {
      this.seq += 1;
      this.setStatus('saving');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push(), 400);
    },

    async push() {
      if (this.saving) return;
      this.saving = true;
      const seq = this.seq;
      const json = JSON.stringify(S.data);
      this.setStatus('saving');
      try {
        this.rev = await this.cloud.saveMain(json, this.rev);
        this.savedSeq = seq;
        await this.publishViews();
        this.setStatus(json.length > SIZE_WARN ? 'large' : 'saved');
      } catch (e) {
        if (e && e.code === 'conflict') {
          this.savedSeq = this.seq;
          alert('其他管理員剛剛更新了資料，你最後一次的修改沒有儲存。\n已載入最新資料，請再確認後重新操作。');
          await this.reloadLatest();
        } else {
          this.setStatus('error', e && e.message);
          // 稍後重試
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.push(), 5000);
        }
      } finally {
        this.saving = false;
      }
      if (this.seq !== this.savedSeq && this.status !== 'error') this.push();
    },

    async reloadLatest() {
      const doc = await this.cloud.loadMain();
      if (doc) {
        this.rev = doc.rev || 0;
        S.setFromRemote(JSON.parse(doc.json));
      }
      this.setStatus('saved');
    },

    async publishViews() {
      const d = S.data;
      for (const b of d.branches) {
        const json = JSON.stringify(C.buildBranchView(d, b.id));
        if (this.published[b.id] === json) continue;
        await this.cloud.publishView(b.id, json);
        this.published[b.id] = json;
      }
    },

    /** 強制重新發布某分校的展示資料 */
    async publishBranch(branchId) {
      delete this.published[branchId];
      const v = C.buildBranchView(S.data, branchId);
      if (!v) return;
      const json = JSON.stringify(v);
      await this.cloud.publishView(branchId, json);
      this.published[branchId] = json;
    },
  };

  root.Sync = Sync;
})(window);

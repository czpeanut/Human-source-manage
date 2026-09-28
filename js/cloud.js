/*
 * 雲端層：Firebase（Firestore + Authentication）
 * 未設定 Firebase 時改用「本機模式」，介面相同。
 *
 * Firestore 結構
 *   app/main                 { rev, json, updatedAt, updatedBy }   完整資料（僅管理員）
 *   branchViews/{branchId}   { json, updatedAt }                   分校展示資料（管理員寫，該分校可讀）
 *   branchLogins/{branchId}  { code, password, uid, email }        分校帳號密碼（僅管理員）
 *   branchAccounts/{uid}     { branchId }                          登入帳號 → 分校對應（管理員寫）
 */
(function () {
  'use strict';
  const cfg = window.HSM_CONFIG || {};
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

  function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---------- 本機模式 ---------- */
  function createLocal() {
    const LOGINS = 'hsm-local-logins';
    const SESSION = 'hsm-local-branch';
    const read = () => { try { return JSON.parse(localStorage.getItem(LOGINS) || '{}') || {}; } catch (e) { return {}; } };
    const write = (v) => localStorage.setItem(LOGINS, JSON.stringify(v));
    const session = () => { try { return sessionStorage.getItem(SESSION); } catch (e) { return null; } };
    const loadData = () => { try { return JSON.parse(localStorage.getItem('hsm-data-v1') || 'null'); } catch (e) { return null; } };
    return {
      mode: 'local',
      codeRe: CODE_RE,
      async waitAuth() { return this.user(); },
      user() { const b = session(); return b ? { uid: 'local-' + b, email: '分校' } : null; },
      async signIn() { throw err('local', '本機模式不需要登入'); },
      async signInBranch(code, password) {
        const hit = Object.entries(read()).find(([, v]) => v.code === code && v.password === password);
        if (!hit) throw err('auth/invalid-credential', '帳號或密碼錯誤');
        sessionStorage.setItem(SESSION, hit[0]);
      },
      async signOut() { sessionStorage.removeItem(SESSION); },
      async myBranchId() { return session(); },
      watchView(branchId, cb) {
        const emit = () => {
          const d = loadData();
          const v = d && window.Core.buildBranchView(d, branchId);
          cb(v ? { json: JSON.stringify(v), updatedAt: null } : null);
        };
        emit();
        const onStorage = (e) => { if (e.key === 'hsm-data-v1') emit(); };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
      },
      async listLogins() { return read(); },
      async setLogin(branchId, code, password) {
        const all = read();
        all[branchId] = { code, password };
        write(all);
      },
      async removeLogin(branchId) {
        const all = read();
        delete all[branchId];
        write(all);
      },
      async publishView() {},
      async deleteView() {},
    };
  }

  /* ---------- Firebase ---------- */
  async function createFirebase(fbcfg, emulator) {
    const [A, U, F] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
    ]);
    const app = A.initializeApp(fbcfg);
    const auth = U.getAuth(app);
    const db = F.getFirestore(app);
    if (emulator) {
      U.connectAuthEmulator(auth, 'http://' + emulator + ':9099', { disableWarnings: true });
      F.connectFirestoreEmulator(db, emulator, 8085);
    }
    const domain = fbcfg.authDomain || (fbcfg.projectId + '.firebaseapp.com');
    const emailFor = (code) => 'branch-' + code + '@' + domain;

    // 用第二個 Auth 實例建立 / 修改分校帳號，避免把管理員登出
    let secAuth = null;
    const sec = () => {
      if (!secAuth) {
        const app2 = A.initializeApp(fbcfg, 'branch-admin');
        secAuth = U.initializeAuth(app2, { persistence: U.inMemoryPersistence });
        if (emulator) U.connectAuthEmulator(secAuth, 'http://' + emulator + ':9099', { disableWarnings: true });
      }
      return secAuth;
    };
    const deleteAccount = async (email, password) => {
      try {
        const cred = await U.signInWithEmailAndPassword(sec(), email, password);
        await U.deleteUser(cred.user);
      } catch (e) {
        // 帳號可能已不存在；沒有 branchAccounts 對應就無法讀取任何資料
      } finally {
        await U.signOut(sec()).catch(() => {});
      }
    };

    const authReady = new Promise((resolve) => {
      const off = U.onAuthStateChanged(auth, () => { off(); resolve(); });
    });
    const mainRef = F.doc(db, 'app', 'main');

    return {
      mode: 'firebase',
      codeRe: CODE_RE,
      async waitAuth() { await authReady; return this.user(); },
      user() { const u = auth.currentUser; return u ? { uid: u.uid, email: u.email } : null; },
      onAuth(cb) { return U.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)); },
      async signIn(email, password) { await U.signInWithEmailAndPassword(auth, email.trim(), password); },
      async signInBranch(code, password) { await U.signInWithEmailAndPassword(auth, emailFor(code.trim().toLowerCase()), password); },
      async signOut() { await U.signOut(auth); },

      watchMain(cb, onError) {
        return F.onSnapshot(mainRef, (s) => cb(s.exists() ? s.data() : null), onError);
      },
      async loadMain() {
        const s = await F.getDocFromServer(mainRef);
        return s.exists() ? s.data() : null;
      },
      async saveMain(json, baseRev) {
        const email = auth.currentUser ? auth.currentUser.email : '';
        return F.runTransaction(db, async (tx) => {
          const snap = await tx.get(mainRef);
          const cur = snap.exists() ? snap.data().rev || 0 : 0;
          if (cur !== baseRev) throw err('conflict', '資料已被其他人更新');
          tx.set(mainRef, { rev: cur + 1, json, updatedAt: F.serverTimestamp(), updatedBy: email });
          return cur + 1;
        });
      },
      async publishView(branchId, json) {
        await F.setDoc(F.doc(db, 'branchViews', branchId), { json, updatedAt: F.serverTimestamp() });
      },
      async deleteView(branchId) {
        await F.deleteDoc(F.doc(db, 'branchViews', branchId));
      },
      watchView(branchId, cb, onError) {
        return F.onSnapshot(F.doc(db, 'branchViews', branchId), (s) => {
          if (!s.exists()) return cb(null);
          const d = s.data();
          cb({ json: d.json, updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate() : null });
        }, onError);
      },
      async myBranchId() {
        const u = auth.currentUser;
        if (!u) return null;
        try {
          const s = await F.getDoc(F.doc(db, 'branchAccounts', u.uid));
          return s.exists() ? s.data().branchId : null;
        } catch (e) {
          return null;
        }
      },

      async listLogins() {
        const qs = await F.getDocs(F.collection(db, 'branchLogins'));
        const out = {};
        qs.forEach((d) => (out[d.id] = d.data()));
        return out;
      },
      async setLogin(branchId, code, password) {
        if (!CODE_RE.test(code)) throw err('invalid-code', '帳號只能使用小寫英文、數字與 -（2–30 字）');
        if (password.length < 6) throw err('weak-password', '密碼至少 6 個字');
        const ref = F.doc(db, 'branchLogins', branchId);
        const snap = await F.getDoc(ref);
        const old = snap.exists() ? snap.data() : null;
        const email = emailFor(code);
        let uid;
        if (old && old.code === code) {
          // 只改密碼
          try {
            const cred = await U.signInWithEmailAndPassword(sec(), old.email, old.password);
            if (old.password !== password) await U.updatePassword(cred.user, password);
            uid = cred.user.uid;
          } finally {
            await U.signOut(sec()).catch(() => {});
          }
        } else {
          try {
            const cred = await U.createUserWithEmailAndPassword(sec(), email, password);
            uid = cred.user.uid;
          } catch (e) {
            if (e.code === 'auth/email-already-in-use') throw err(e.code, '此帳號已被使用，請換一個');
            throw e;
          } finally {
            await U.signOut(sec()).catch(() => {});
          }
          if (old) {
            await deleteAccount(old.email, old.password);
            if (old.uid) await F.deleteDoc(F.doc(db, 'branchAccounts', old.uid)).catch(() => {});
          }
        }
        await F.setDoc(F.doc(db, 'branchAccounts', uid), { branchId });
        await F.setDoc(ref, { code, password, uid, email, updatedAt: F.serverTimestamp() });
      },
      async removeLogin(branchId) {
        const ref = F.doc(db, 'branchLogins', branchId);
        const snap = await F.getDoc(ref);
        if (!snap.exists()) return;
        const old = snap.data();
        if (old.uid) await F.deleteDoc(F.doc(db, 'branchAccounts', old.uid)).catch(() => {});
        await F.deleteDoc(ref);
        await deleteAccount(old.email, old.password);
      },
    };
  }

  /* ---------- 選擇模式 ---------- */
  // 開發測試：在 localhost 使用 ?emulator=<projectId> 連到 Firebase 模擬器
  const params = new URLSearchParams(location.search);
  const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  let fbcfg = cfg.firebase;
  let emulator = null;
  if (isLocalHost && params.get('emulator')) {
    const pid = params.get('emulator');
    fbcfg = { apiKey: 'demo-key', projectId: pid, authDomain: pid + '.firebaseapp.com' };
    emulator = location.hostname;
  }

  window.CloudReady = fbcfg ? createFirebase(fbcfg, emulator) : Promise.resolve(createLocal());
})();

/*
 * 系統設定
 *
 * 把 Firebase 主控台「專案設定 → 一般 → 你的應用程式 → SDK 設定」中的 firebaseConfig 貼到下面。
 * 未設定（null）時為「本機模式」：資料只存在這台電腦的瀏覽器，僅供試用。
 * 這些值不是密碼，放在網頁中是正常的；資料安全由 firestore.rules 保護。
 */
window.HSM_CONFIG = {
  firebase: null,
  // firebase: {
  //   apiKey: 'AIza...',
  //   authDomain: 'your-project.firebaseapp.com',
  //   projectId: 'your-project',
  //   appId: '1:...:web:...',
  // },
};

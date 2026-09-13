/** Browser backup for prefs, places, favorites, watchlist — syncs to server when instance restarts. */
const WindmateLocalUserState = (() => {
  const STORAGE_KEY = 'windmate:userState:v1';
  let captureTimer = null;
  let apiFn = null;

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeStore(record) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (err) {
      console.warn('[localUserState] save failed:', err.message);
    }
  }

  function saveFromRemote(remote) {
    if (!remote?.bundle) return;
    writeStore({
      serverInstanceId: remote.serverInstanceId,
      updated_at: remote.bundle.updated_at ?? Date.now(),
      bundle: remote.bundle,
    });
  }

  function shouldPushLocal(local, remote) {
    if (!local?.bundle) return false;
    if (!remote?.serverInstanceId) return true;
    if (local.serverInstanceId !== remote.serverInstanceId) return true;
    const localAt = local.updated_at ?? 0;
    const remoteAt = remote.bundle?.updated_at ?? 0;
    return localAt > remoteAt;
  }

  function shouldPullRemote(local, remote) {
    if (!remote?.bundle) return false;
    if (!local?.bundle) return true;
    if (local.serverInstanceId !== remote.serverInstanceId) return false;
    const localAt = local.updated_at ?? 0;
    const remoteAt = remote.bundle.updated_at ?? 0;
    return remoteAt > localAt;
  }

  async function fetchRemote() {
    return apiFn('/api/user-state');
  }

  async function pushBundle(bundle) {
    return apiFn('/api/user-state', {
      method: 'PUT',
      body: JSON.stringify({ bundle }),
    });
  }

  /**
   * Call before loadPreferences. Restores local snapshot when Render restarts (new serverInstanceId).
   * @returns {Promise<{ restored: boolean, preferences?: object }>}
   */
  async function syncOnBoot(fetchApi) {
    apiFn = fetchApi;
    const local = readStore();
    const remote = await fetchRemote();

    if (shouldPushLocal(local, remote)) {
      const result = await pushBundle(local.bundle);
      saveFromRemote({
        serverInstanceId: result.serverInstanceId,
        bundle: result.bundle,
      });
      return { restored: true, preferences: result.preferences };
    }

    if (shouldPullRemote(local, remote)) {
      saveFromRemote(remote);
    }

    return { restored: false };
  }

  function scheduleCapture() {
    if (!apiFn) return;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureFromServer().catch((err) => console.warn('[localUserState] capture:', err.message));
    }, 400);
  }

  async function captureFromServer() {
    const remote = await fetchRemote();
    saveFromRemote(remote);
  }

  function noteMutation() {
    scheduleCapture();
  }

  function init(fetchApi) {
    apiFn = fetchApi;
  }

  return {
    init,
    syncOnBoot,
    scheduleCapture,
    noteMutation,
    captureFromServer,
  };
})();

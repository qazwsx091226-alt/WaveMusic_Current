(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const YOUTUBE_API_KEY = 'AIzaSyB2hE-XACpGUV7L7wYGEX1rsRKeGd6f9Vc';

  const RECENT_KEY = 'waveMusicRecentYoutubeV2';
  const LIKES_KEY = 'waveMusicYoutubeLikesV2';
  const SEARCH_CACHE_KEY = 'waveMusicSearchCacheV4';
  const SIDEBAR_STATE_KEY = 'waveMusicSidebarCollapsed';
  const PLAYLISTS_KEY = 'waveMusicPlaylistsV1';

  function loadJSON(key, fallback, storage = localStorage) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, value, storage = localStorage) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  let recentYoutube = loadJSON(RECENT_KEY, []);
  let likedYoutube = loadJSON(LIKES_KEY, []);
  let playlists = loadJSON(PLAYLISTS_KEY, []);
  let searchCache = loadJSON(SEARCH_CACHE_KEY, {}, sessionStorage);

  let recommendedYoutube = [];
  let recommendationPool = [];
  let youtubeResults = [];
  let exploreResults = [];
  let currentQueue = [];
  let currentQueueIndex = -1;
  let currentYoutubeVideo = null;
  let ytPlayer = null;
  let youtubeApiRequested = false;
  let pendingVideo = null;
  let progressTimer = null;
  let repeatEnabled = false;
  let activePlaylistId = null;
  let playlistLoopEnabled = false;
  let searchSerial = 0;
  let lastExploreQuery = '';
  let playerErrorMoving = false;
  let consecutivePlaybackErrors = 0;
  let playlistPickerVideo = null;

  const searchInput = $('#searchInput');
  const searchPanel = $('#youtubeSearchPanel');
  const centerPlayerSection = $('#centerPlayerSection');
  const playBtn = $('#playBtn');
  const centerPlayBtn = $('#centerPlayBtn');
  const progressFill = $('#progressFill');
  const centerProgressFill = $('#centerProgressFill');
  const volume = $('#volume');
  const centerVolume = $('#centerVolume');

  function safe(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }

  function decodeHTML(value = '') {
    const t = document.createElement('textarea');
    t.innerHTML = String(value);
    return t.value;
  }

  function normalizeText(value = '') {
    return String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function formatTime(seconds) {
    seconds = Number(seconds);
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = String(Math.floor(seconds % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function validApiKey() {
    return Boolean(YOUTUBE_API_KEY && !YOUTUBE_API_KEY.includes('여기에_'));
  }

  function isSongVideo(video) {
    const title = normalizeText(video?.title || '');
    const channel = normalizeText(video?.channelTitle || '');

    const isTopic = /[-–—]\s*topic$/i.test(channel);
    const isVevo = channel.includes('vevo');

    const songSignals = [
      'official audio','official mv','official m/v','official music video',
      'official video','music video','lyric video','lyrics video',
      'official lyric','official lyrics','visualizer','[mv]','[m/v]',
      '(mv)','(m/v)',' mv ',' m/v ','뮤직비디오','공식 음원',
      '공식음원','가사 영상','가사영상'
    ];

    const blockedWords = [
      'playlist','플레이리스트','reaction','리액션','interview','인터뷰',
      'teaser','티저','trailer','트레일러','behind','비하인드',
      'making film','making of','메이킹','dance practice','practice video',
      '안무영상','안무 영상','shorts','#shorts','challenge','챌린지',
      'documentary','다큐','vlog','브이로그','unboxing','언박싱',
      'preview','미리보기','highlight medley','하이라이트 메들리',
      'album preview','track list','tracklist'
    ];

    if (blockedWords.some(w => title.includes(w))) return false;
    return isTopic || isVevo || songSignals.some(w => title.includes(w));
  }

  /* ===================== SPA ===================== */

  const routes = ['home','explore','library','team','log'];

  function getRoute() {
    const route = (location.hash || '#home').slice(1);
    return routes.includes(route) ? route : 'home';
  }

  function updateCenterPlayerVisibility() {
    if (!centerPlayerSection) return;
    centerPlayerSection.classList.toggle(
      'hidden',
      !(getRoute() === 'home' && currentYoutubeVideo)
    );
  }

  function setRoute(route, updateURL = true) {
    if (!routes.includes(route)) route = 'home';
    $$('.app-view').forEach(v => v.classList.add('hidden'));
    $(`#view-${route}`)?.classList.remove('hidden');
    $$('.route-link[data-route]').forEach(link => {
      link.classList.toggle('active', link.dataset.route === route);
    });
    if (updateURL && location.hash !== `#${route}`) {
      history.pushState(null, '', `#${route}`);
    }
    updateCenterPlayerVisibility();
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  document.addEventListener('click', e => {
    const routeLink = e.target.closest('.route-link[data-route]');
    if (!routeLink) return;
    e.preventDefault();
    setRoute(routeLink.dataset.route, true);
  });

  window.addEventListener('hashchange', () => setRoute(getRoute(), false));
  window.addEventListener('popstate', () => setRoute(getRoute(), false));

  /* ===================== Sidebar ===================== */

  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  let sidebarCollapsed = false;
  try { sidebarCollapsed = localStorage.getItem(SIDEBAR_STATE_KEY) === '1'; } catch (_) {}
  setSidebarCollapsed(sidebarCollapsed);

  $('#sidebarToggle')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
  });

  /* ===================== Playlist UI ===================== */

  function ensurePlaylistUI() {
    if (!$('#wavePlaylistModal')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="wavePlaylistModal" class="wave-playlist-modal hidden">
          <div id="wavePlaylistDialog" class="wave-playlist-dialog"></div>
        </div>
      `);
      $('#wavePlaylistModal')?.addEventListener('click', e => {
        if (e.target.id === 'wavePlaylistModal') closePlaylistModal();
      });
    }

    if (!$('#waveCardMenu')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="waveCardMenu" class="wave-card-menu hidden">
          <button id="waveAddToPlaylistMenu" type="button">＋ 재생목록에 추가</button>
        </div>
      `);
      $('#waveAddToPlaylistMenu')?.addEventListener('click', () => {
        closeCardMenu();
        if (playlistPickerVideo) openPlaylistPicker(playlistPickerVideo);
      });
    }
  }

  const closePlaylistModal = () => $('#wavePlaylistModal')?.classList.add('hidden');
  const closeCardMenu = () => $('#waveCardMenu')?.classList.add('hidden');

  document.addEventListener('click', e => {
    if (!e.target.closest('#waveCardMenu') && !e.target.closest('.card-more-button')) closeCardMenu();
    if (searchPanel && !e.target.closest('.search-box') && !e.target.closest('#youtubeSearchPanel')) closeSearchPanel();
  });
  window.addEventListener('resize', closeCardMenu);
  window.addEventListener('scroll', closeCardMenu, true);

  function savePlaylists() {
    saveJSON(PLAYLISTS_KEY, playlists);
  }

  function createPlaylist(reopenVideo = null) {
    const input = prompt('새 재생목록 이름을 입력해 주세요.');
    if (input === null) return null;
    const name = input.trim();
    if (!name) return toast('재생목록 이름을 입력해 주세요.'), null;

    const duplicate = playlists.some(p => normalizeText(p.name) === normalizeText(name));
    if (duplicate) return toast('같은 이름의 재생목록이 이미 있습니다.'), null;

    const playlist = {
      id:`playlist_${Date.now()}`,
      name,
      songs:[],
      loop:false,
      createdAt:Date.now()
    };

    playlists.unshift(playlist);
    savePlaylists();
    renderPlaylists();
    toast(`"${name}" 재생목록을 만들었습니다.`);
    if (reopenVideo) openPlaylistPicker(reopenVideo);
    return playlist;
  }

  $('#createPlaylistBtn')?.addEventListener('click', () => createPlaylist());

  function addSongToPlaylist(playlistId, video) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || !video?.videoId) return;
    if (!Array.isArray(playlist.songs)) playlist.songs = [];

    if (playlist.songs.some(s => s.videoId === video.videoId)) {
      toast(`"${playlist.name}"에 이미 들어있는 곡입니다.`);
      return;
    }

    playlist.songs.push({
      videoId:video.videoId,
      title:video.title,
      channelTitle:video.channelTitle,
      thumbnail:video.thumbnail
    });

    savePlaylists();
    renderPlaylists();
    closePlaylistModal();
    toast(`"${playlist.name}"에 추가했습니다.`);
  }

  function openPlaylistPicker(video) {
    ensurePlaylistUI();
    playlistPickerVideo = video;

    const modal = $('#wavePlaylistModal');
    const dialog = $('#wavePlaylistDialog');
    if (!modal || !dialog) return;

    dialog.innerHTML = `
      <div class="wave-modal-head">
        <div><span class="small-label">ADD TO PLAYLIST</span><h2>재생목록에 추가</h2></div>
        <button id="playlistModalClose" class="wave-modal-close" type="button">×</button>
      </div>
      <div class="playlist-target-song">
        <img src="${safe(video.thumbnail || '')}" alt="">
        <div><strong>${safe(video.title || '제목 없음')}</strong><span>${safe(video.channelTitle || 'YouTube')}</span></div>
      </div>
      <div class="playlist-picker-list">
        ${playlists.length ? playlists.map(p => {
          const songs = Array.isArray(p.songs) ? p.songs : [];
          const exists = songs.some(s => s.videoId === video.videoId);
          return `
            <button class="playlist-picker-item" data-target-playlist="${safe(p.id)}" type="button">
              <div class="picker-cover">${songs[0]?.thumbnail ? `<img src="${safe(songs[0].thumbnail)}" alt="">` : '♫'}</div>
              <div class="picker-info"><strong>${safe(p.name)}</strong><span>${songs.length}곡${p.loop ? ' · 🔁' : ''}</span></div>
              <div class="picker-state">${exists ? '✓ 추가됨' : '＋'}</div>
            </button>`;
        }).join('') : '<div class="playlist-picker-empty">아직 재생목록이 없습니다.</div>'}
      </div>
      <button id="pickerCreatePlaylist" class="picker-create-button" type="button">＋ 새 재생목록 만들기</button>
    `;

    $('#playlistModalClose')?.addEventListener('click', closePlaylistModal);
    $$('.playlist-picker-item', dialog).forEach(btn => {
      btn.addEventListener('click', () => addSongToPlaylist(btn.dataset.targetPlaylist, video));
    });
    $('#pickerCreatePlaylist')?.addEventListener('click', () => {
      closePlaylistModal();
      createPlaylist(video);
    });

    modal.classList.remove('hidden');
  }

  function removeSongFromPlaylist(playlistId, videoId) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    p.songs = (p.songs || []).filter(s => s.videoId !== videoId);
    savePlaylists();
    renderPlaylists();
    openPlaylistDetail(playlistId);
    toast('재생목록에서 삭제했습니다.');
  }

  function deletePlaylist(playlistId) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p || !confirm(`"${p.name}" 재생목록을 삭제할까요?`)) return;

    playlists = playlists.filter(x => x.id !== playlistId);
    if (activePlaylistId === playlistId) {
      activePlaylistId = null;
      playlistLoopEnabled = false;
    }
    savePlaylists();
    renderPlaylists();
    closePlaylistModal();
    toast('재생목록을 삭제했습니다.');
  }

  function renamePlaylist(playlistId) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    const input = prompt('새 재생목록 이름을 입력해 주세요.', p.name);
    if (input === null) return;
    const newName = input.trim();
    if (!newName) return toast('재생목록 이름을 입력해 주세요.');
    if (playlists.some(x => x.id !== playlistId && normalizeText(x.name) === normalizeText(newName))) {
      return toast('같은 이름의 재생목록이 이미 있습니다.');
    }
    p.name = newName;
    savePlaylists();
    renderPlaylists();
    openPlaylistDetail(playlistId);
    toast('재생목록 이름을 변경했습니다.');
  }

  function clearPlaylistSongs(playlistId) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    if (!p.songs?.length) return toast('재생목록이 이미 비어 있습니다.');
    if (!confirm(`"${p.name}"의 모든 곡을 삭제할까요?`)) return;
    p.songs = [];
    if (activePlaylistId === playlistId) {
      activePlaylistId = null;
      playlistLoopEnabled = false;
    }
    savePlaylists();
    renderPlaylists();
    openPlaylistDetail(playlistId);
    toast('재생목록의 모든 곡을 삭제했습니다.');
  }

  function togglePlaylistLoop(playlistId) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    p.loop = !Boolean(p.loop);
    if (activePlaylistId === playlistId) playlistLoopEnabled = p.loop;
    savePlaylists();
    renderPlaylists();
    openPlaylistDetail(playlistId);
    toast(p.loop ? '재생목록 무한재생을 켰습니다. 🔁' : '재생목록 무한재생을 껐습니다.');
  }

  function playPlaylist(playlistId, shuffle = false) {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    const songs = Array.isArray(p.songs) ? p.songs : [];
    if (!songs.length) return toast('재생목록에 음악이 없습니다.');

    const queue = shuffle ? shuffleArray(songs) : [...songs];
    closePlaylistModal();
    playWithQueue(queue[0], queue, { playlistId:p.id, loop:Boolean(p.loop) });
    toast(`"${p.name}" ${shuffle ? '셔플 ' : ''}재생을 시작했습니다.`);
  }

  function openPlaylistDetail(playlistId) {
    ensurePlaylistUI();
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;
    const songs = Array.isArray(p.songs) ? p.songs : [];
    const loop = Boolean(p.loop);
    const modal = $('#wavePlaylistModal');
    const dialog = $('#wavePlaylistDialog');
    if (!modal || !dialog) return;

    dialog.innerHTML = `
      <div class="wave-modal-head">
        <div><span class="small-label">PLAYLIST</span><h2>${safe(p.name)}</h2><p>${songs.length}곡${loop ? ' · 🔁 무한재생' : ''}</p></div>
        <button id="playlistModalClose" class="wave-modal-close" type="button">×</button>
      </div>
      <div class="playlist-detail-actions">
        <button id="playlistPlayAll" class="playlist-play-all" type="button" ${songs.length ? '' : 'disabled'}>▶ 전체 재생</button>
        <button id="playlistShufflePlay" class="playlist-shuffle-button" type="button" ${songs.length ? '' : 'disabled'}>🔀 셔플 재생</button>
        <button id="playlistLoopBtn" class="playlist-loop-button ${loop ? 'active' : ''}" type="button">🔁 무한재생 ${loop ? 'ON' : 'OFF'}</button>
      </div>
      <div class="playlist-manage-actions">
        <button id="renamePlaylistBtn" class="playlist-manage-button" type="button">✏ 이름 변경</button>
        <button id="clearPlaylistSongsBtn" class="playlist-manage-button" type="button" ${songs.length ? '' : 'disabled'}>🧹 곡 비우기</button>
        <button id="deletePlaylistBtn" class="playlist-delete-button" type="button">재생목록 삭제</button>
      </div>
      <div class="playlist-song-list">
        ${songs.length ? songs.map((song, index) => `
          <div class="playlist-song-row">
            <span class="playlist-song-number">${index + 1}</span>
            <button class="playlist-song-play" data-playlist-play="${index}" type="button">
              <img src="${safe(song.thumbnail || '')}" alt="">
              <span><strong>${safe(song.title || '제목 없음')}</strong><small>${safe(song.channelTitle || 'YouTube')}</small></span>
            </button>
            <button class="playlist-song-remove" data-playlist-remove="${safe(song.videoId)}" type="button" title="재생목록에서 삭제">×</button>
          </div>`).join('') : '<div class="playlist-picker-empty">아직 음악이 없습니다.<br>노래의 ⋮ 버튼을 눌러 재생목록에 추가해보세요.</div>'}
      </div>
    `;

    $('#playlistModalClose')?.addEventListener('click', closePlaylistModal);
    $('#playlistPlayAll')?.addEventListener('click', () => playPlaylist(playlistId, false));
    $('#playlistShufflePlay')?.addEventListener('click', () => playPlaylist(playlistId, true));
    $('#playlistLoopBtn')?.addEventListener('click', () => togglePlaylistLoop(playlistId));
    $('#renamePlaylistBtn')?.addEventListener('click', () => renamePlaylist(playlistId));
    $('#clearPlaylistSongsBtn')?.addEventListener('click', () => clearPlaylistSongs(playlistId));
    $('#deletePlaylistBtn')?.addEventListener('click', () => deletePlaylist(playlistId));

    $$('[data-playlist-play]', dialog).forEach(btn => {
      btn.addEventListener('click', () => {
        const song = songs[Number(btn.dataset.playlistPlay)];
        if (!song) return;
        closePlaylistModal();
        playWithQueue(song, songs, { playlistId:p.id, loop:Boolean(p.loop) });
      });
    });

    $$('[data-playlist-remove]', dialog).forEach(btn => {
      btn.addEventListener('click', () => removeSongFromPlaylist(playlistId, btn.dataset.playlistRemove));
    });

    modal.classList.remove('hidden');
  }

  function renderPlaylists() {
    const root = $('#playlistGrid');
    if (!root) return;

    if (!playlists.length) {
      root.innerHTML = '<div class="playlist-empty">아직 만든 재생목록이 없습니다.<br><strong>+ 재생목록 만들기</strong> 버튼을 눌러 만들어보세요.</div>';
      return;
    }

    root.innerHTML = playlists.map(p => {
      const songs = Array.isArray(p.songs) ? p.songs : [];
      return `
        <article class="playlist-card" data-open-playlist="${safe(p.id)}">
          <div class="playlist-cover">${songs[0]?.thumbnail ? `<img src="${safe(songs[0].thumbnail)}" alt="">` : '♫'}</div>
          <h3>${safe(p.name)}</h3>
          <p>${songs.length}곡${p.loop ? ' · 🔁 무한재생' : ''}</p>
        </article>`;
    }).join('');

    $$('[data-open-playlist]', root).forEach(card => {
      card.addEventListener('click', () => openPlaylistDetail(card.dataset.openPlaylist));
    });
  }

  function openCardMenu(button, video) {
    ensurePlaylistUI();
    playlistPickerVideo = video;
    const menu = $('#waveCardMenu');
    if (!menu) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    let left = rect.right - 190;
    left = Math.max(10, Math.min(left, window.innerWidth - 200));
    menu.style.left = `${left}px`;
    menu.classList.remove('hidden');
  }

  /* ===================== Cards ===================== */

  function videoCardHTML(video) {
    return `
      <article class="music-card" data-video-id="${safe(video.videoId)}">
        <div class="music-cover">
          <img src="${safe(video.thumbnail || '')}" alt="${safe(video.title || '')}">
          <div class="music-hover"><div class="card-play">▶</div></div>
          <button class="card-more-button" type="button" title="더보기" aria-label="음악 메뉴">⋮</button>
        </div>
        <div class="music-card-text"><h3>${safe(video.title || '제목 없음')}</h3><p>${safe(video.channelTitle || 'YouTube')}</p></div>
      </article>`;
  }

  function emptyHTML(title, description) {
    return `<div class="empty-box"><strong>${safe(title)}</strong><span>${safe(description)}</span></div>`;
  }

  function bindVideoCards(root, list) {
    if (!root) return;
    $$('.music-card', root).forEach(card => {
      const video = list.find(x => x.videoId === card.dataset.videoId);
      if (!video) return;

      card.addEventListener('click', e => {
        if (e.target.closest('.card-more-button')) return;
        consecutivePlaybackErrors = 0;
        playWithQueue(video, list);
      });

      const more = $('.card-more-button', card);
      more?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openCardMenu(more, video);
      });
    });
  }

  /* ===================== Recent ===================== */

  function addRecent(video) {
    if (!video?.videoId) return;
    recentYoutube = recentYoutube.filter(x => x.videoId !== video.videoId);
    recentYoutube.unshift({
      videoId:video.videoId,
      title:video.title,
      channelTitle:video.channelTitle,
      thumbnail:video.thumbnail
    });
    recentYoutube = recentYoutube.slice(0, 30);
    saveJSON(RECENT_KEY, recentYoutube);
    renderRecent();
  }

  function renderRecent() {
    const root = $('#recentYoutubeGrid');
    if (!root) return;
    if (!recentYoutube.length) {
      root.innerHTML = emptyHTML('아직 다시 들을 음악이 없습니다.', '음악을 검색하고 재생하면 최근 재생한 곡이 표시됩니다.');
      return;
    }
    root.innerHTML = recentYoutube.map(videoCardHTML).join('');
    bindVideoCards(root, recentYoutube);
  }

  $('#recentPrev')?.addEventListener('click', () => $('#recentYoutubeGrid')?.scrollBy({ left:-800, behavior:'smooth' }));
  $('#recentNext')?.addEventListener('click', () => $('#recentYoutubeGrid')?.scrollBy({ left:800, behavior:'smooth' }));

  /* ===================== Recommendation ===================== */

  function shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function chooseRandomRecommendations() {
    if (!recommendationPool.length) {
      recommendedYoutube = [];
      renderRecommendations();
      return;
    }
    recommendedYoutube = shuffleArray(recommendationPool).slice(0, 18);
    renderRecommendations();
  }

  async function loadRecommendations(forceReload = false) {
    const root = $('#recommendedYoutubeGrid');
    if (!root) return;

    if (recommendationPool.length && !forceReload) {
      chooseRandomRecommendations();
      return;
    }

    root.innerHTML = emptyHTML('추천 음악을 불러오는 중...', 'YouTube 음악 카테고리에서 노래를 찾고 있습니다.');
    if (!validApiKey()) {
      root.innerHTML = emptyHTML('YouTube API Key가 필요합니다.', 'app.js의 YOUTUBE_API_KEY에 API Key를 넣어주세요.');
      return;
    }

    try {
      const params = new URLSearchParams({
        part:'snippet,status',
        chart:'mostPopular',
        regionCode:'KR',
        videoCategoryId:'10',
        maxResults:'50',
        key:YOUTUBE_API_KEY
      });

      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || '추천 음악 오류');

      recommendationPool = (data.items || [])
        .filter(item => item?.id && item?.snippet && String(item.snippet?.categoryId) === '10' && item?.status?.embeddable !== false)
        .map(item => ({
          videoId:item.id,
          title:decodeHTML(item.snippet?.title || '제목 없음'),
          channelTitle:decodeHTML(item.snippet?.channelTitle || 'YouTube'),
          thumbnail:item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
        }))
        .filter(isSongVideo);

      chooseRandomRecommendations();
    } catch (error) {
      console.error(error);
      root.innerHTML = emptyHTML('추천 음악을 불러오지 못했습니다.', '인터넷 연결 또는 API 설정을 확인해 주세요.');
    }
  }

  function renderRecommendations() {
    const root = $('#recommendedYoutubeGrid');
    if (!root) return;
    if (!recommendedYoutube.length) {
      root.innerHTML = emptyHTML('추천 음악이 없습니다.', '조건에 맞는 노래를 찾지 못했습니다.');
      return;
    }
    root.innerHTML = recommendedYoutube.map(videoCardHTML).join('');
    bindVideoCards(root, recommendedYoutube);
  }

  $('#refreshRecommendations')?.addEventListener('click', async () => {
    const btn = $('#refreshRecommendations');
    if (btn) { btn.disabled = true; btn.textContent = '섞는 중...'; }
    if (!recommendationPool.length) await loadRecommendations();
    else chooseRandomRecommendations();
    if (btn) { btn.disabled = false; btn.textContent = '새로고침'; }
  });

  /* ===================== Likes ===================== */

  const isLiked = videoId => likedYoutube.some(x => x.videoId === videoId);

  function toggleLike() {
    if (!currentYoutubeVideo) return toast('먼저 음악을 재생해 주세요.');
    const idx = likedYoutube.findIndex(x => x.videoId === currentYoutubeVideo.videoId);
    if (idx >= 0) {
      likedYoutube.splice(idx, 1);
      toast('좋아요를 취소했습니다.');
    } else {
      likedYoutube.unshift({
        videoId:currentYoutubeVideo.videoId,
        title:currentYoutubeVideo.title,
        channelTitle:currentYoutubeVideo.channelTitle,
        thumbnail:currentYoutubeVideo.thumbnail
      });
      toast('보관함에 추가했습니다. ♥');
    }
    saveJSON(LIKES_KEY, likedYoutube);
    syncLikeButtons();
    renderLibrary();
  }

  function syncLikeButtons() {
    const liked = currentYoutubeVideo && isLiked(currentYoutubeVideo.videoId);
    [$('#centerLikeBtn'), $('#playerLikeBtn')].filter(Boolean).forEach(btn => {
      btn.textContent = liked ? '♥' : '♡';
      btn.classList.toggle('liked', Boolean(liked));
    });
  }

  $('#centerLikeBtn')?.addEventListener('click', toggleLike);
  $('#playerLikeBtn')?.addEventListener('click', toggleLike);

  function renderLibrary() {
    const root = $('#likedYoutubeGrid');
    if (!root) return;
    if (!likedYoutube.length) {
      root.innerHTML = emptyHTML('보관함이 비어 있습니다.', '재생 중인 음악의 ♡ 버튼을 누르면 저장됩니다.');
      return;
    }
    root.innerHTML = likedYoutube.map(videoCardHTML).join('');
    bindVideoCards(root, likedYoutube);
  }

  $('#clearLikesBtn')?.addEventListener('click', () => {
    if (!confirm('좋아요 음악을 모두 삭제할까요?')) return;
    likedYoutube = [];
    saveJSON(LIKES_KEY, likedYoutube);
    renderLibrary();
    syncLikeButtons();
    toast('좋아요를 초기화했습니다.');
  });

  /* ===================== Quick playlist buttons ===================== */

  function createQuickPlaylistButtons() {
    const playerLike = $('#playerLikeBtn');
    if (playerLike && !$('#playerPlaylistBtn')) {
      const btn = document.createElement('button');
      btn.id = 'playerPlaylistBtn';
      btn.type = 'button';
      btn.className = 'quick-playlist-button';
      btn.textContent = '＋';
      btn.title = '재생목록에 추가';
      playerLike.insertAdjacentElement('afterend', btn);
      btn.addEventListener('click', () => {
        if (!currentYoutubeVideo) return toast('먼저 음악을 재생해 주세요.');
        openPlaylistPicker(currentYoutubeVideo);
      });
    }

    const centerLike = $('#centerLikeBtn');
    if (centerLike && !$('#centerPlaylistBtn')) {
      const btn = document.createElement('button');
      btn.id = 'centerPlaylistBtn';
      btn.type = 'button';
      btn.className = 'quick-playlist-button';
      btn.textContent = '＋';
      btn.title = '재생목록에 추가';
      centerLike.insertAdjacentElement('afterend', btn);
      btn.addEventListener('click', () => {
        if (!currentYoutubeVideo) return toast('먼저 음악을 재생해 주세요.');
        openPlaylistPicker(currentYoutubeVideo);
      });
    }
  }

  /* ===================== YouTube Player ===================== */

  function loadYouTubePlayerAPI() {
    if (youtubeApiRequested) return;
    youtubeApiRequested = true;

    window.onYouTubeIframeAPIReady = () => {
      if (!pendingVideo) return;
      const video = pendingVideo;
      pendingVideo = null;
      createOrLoadPlayer(video);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  }

  function createPrivacyIframe(videoId) {
    const container = $('#youtubePlayer');
    if (!container) return null;
    container.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.id = 'youtubePlayerFrame';

    const params = new URLSearchParams({
      enablejsapi:'1',autoplay:'1',controls:'1',rel:'0',playsinline:'1'
    });

    if ((location.protocol === 'http:' || location.protocol === 'https:') && location.origin && location.origin !== 'null') {
      params.set('origin', location.origin);
    }

    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
    iframe.title = 'YouTube video player';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    container.appendChild(iframe);
    return iframe;
  }

  function createOrLoadPlayer(video) {
    if (!video?.videoId) return;

    if (!window.YT || !YT.Player) {
      pendingVideo = video;
      loadYouTubePlayerAPI();
      return;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      playerErrorMoving = false;
      try { ytPlayer.loadVideoById(video.videoId); } catch (_) {}
      return;
    }

    const iframe = createPrivacyIframe(video.videoId);
    if (!iframe) return toast('YouTube 플레이어를 찾을 수 없습니다.');

    ytPlayer = new YT.Player(iframe, {
      events:{
        onReady:event => {
          try {
            event.target.setVolume(Math.round(getVolume() * 100));
            event.target.playVideo();
          } catch (_) {}
          startProgressTimer();
        },
        onAutoplayBlocked:() => {
          setPlaying(false);
          toast('브라우저가 자동재생을 차단했습니다. ▶ 버튼을 눌러주세요.');
        },
        onStateChange:event => {
          if (!window.YT) return;

          if (event.data === YT.PlayerState.PLAYING) {
            playerErrorMoving = false;
            consecutivePlaybackErrors = 0;
            setPlaying(true);
            startProgressTimer();
          } else if (event.data === YT.PlayerState.PAUSED) {
            setPlaying(false);
          } else if (event.data === YT.PlayerState.ENDED) {
            setPlaying(false);

            if (repeatEnabled) {
              try { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); } catch (_) {}
              return;
            }

            if (activePlaylistId && !playlistLoopEnabled && currentQueueIndex === currentQueue.length - 1) {
              toast('재생목록 재생이 끝났습니다.');
              return;
            }

            nextVideo(1);
          }
        },
        onError:event => handlePlayerError(event?.data)
      }
    });
  }

  function handlePlayerError(errorCode) {
    setPlaying(false);
    console.warn('YouTube 재생 오류:', errorCode);
    if (playerErrorMoving) return;

    if (errorCode === 153) {
      toast('YouTube 오류 153: Live Server로 실행해 주세요.');
      return;
    }

    if ([5,100,101,150].includes(errorCode)) {
      playerErrorMoving = true;
      consecutivePlaybackErrors++;

      if (consecutivePlaybackErrors >= Math.max(1, currentQueue.length)) {
        playerErrorMoving = false;
        consecutivePlaybackErrors = 0;
        toast('현재 목록에서 재생 가능한 곡을 찾지 못했습니다.');
        return;
      }

      toast('재생할 수 없는 영상이라 다음 곡으로 넘어갑니다.');
      setTimeout(() => {
        playerErrorMoving = false;
        if (activePlaylistId && !playlistLoopEnabled && currentQueueIndex === currentQueue.length - 1) {
          toast('재생목록 재생이 끝났습니다.');
          return;
        }
        nextVideo(1);
      }, 700);
      return;
    }

    toast(`YouTube 재생 오류 ${errorCode ?? '?'}`);
  }

  /* ===================== Queue / playback ===================== */

  function playWithQueue(video, queue, options = {}) {
    if (!video) return;
    currentQueue = Array.isArray(queue) ? [...queue] : [video];
    currentQueueIndex = currentQueue.findIndex(x => x.videoId === video.videoId);
    if (currentQueueIndex < 0) {
      currentQueue.unshift(video);
      currentQueueIndex = 0;
    }
    activePlaylistId = options.playlistId || null;
    playlistLoopEnabled = Boolean(options.loop);
    consecutivePlaybackErrors = 0;
    playVideo(video);
  }

  function playVideo(video) {
    if (!video) return;
    currentYoutubeVideo = video;
    addRecent(video);
    updateTrackInfo(video);
    syncLikeButtons();
    updateCenterPlayerVisibility();
    createOrLoadPlayer(video);
    closeSearchPanel();

    if (getRoute() === 'home') {
      setTimeout(() => centerPlayerSection?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
    }
  }

  function nextVideo(direction) {
    if (!currentQueue.length) return;

    if (activePlaylistId && !playlistLoopEnabled) {
      const nextIndex = currentQueueIndex + direction;
      if (nextIndex >= currentQueue.length) return toast('재생목록의 마지막 곡입니다.');
      if (nextIndex < 0) return toast('재생목록의 첫 번째 곡입니다.');
      currentQueueIndex = nextIndex;
    } else {
      currentQueueIndex = (currentQueueIndex + direction + currentQueue.length) % currentQueue.length;
    }

    playVideo(currentQueue[currentQueueIndex]);
  }

  function shuffleVideo() {
    if (currentQueue.length <= 1) return;
    let index = currentQueueIndex;
    while (index === currentQueueIndex) index = Math.floor(Math.random() * currentQueue.length);
    currentQueueIndex = index;
    playVideo(currentQueue[index]);
  }

  /* ===================== Track UI ===================== */

  function setCenterMarqueeTitle(title) {
    const viewport = $('#centerTitleViewport');
    const track = $('#centerNowTitle');
    if (!track) return;
    if (!viewport) { track.textContent = title; return; }

    const copies = track.querySelectorAll('.center-title-copy');
    if (!copies.length) { track.textContent = title; return; }

    copies.forEach(c => c.textContent = title);
    track.classList.remove('is-marquee');
    track.style.removeProperty('--title-marquee-speed');

    requestAnimationFrame(() => {
      const first = copies[0];
      if (!first) return;
      const titleWidth = first.scrollWidth;
      const available = viewport.clientWidth;
      if (titleWidth > available) {
        const duration = Math.max(10, Math.min(24, 10 + (titleWidth - available) / 45));
        track.style.setProperty('--title-marquee-speed', `${duration}s`);
        track.classList.add('is-marquee');
      }
    });
  }

  function updateTrackInfo(video) {
    const title = video.title || '제목 없음';
    const artist = `${video.channelTitle || 'YouTube'} · YouTube`;
    setCenterMarqueeTitle(title);

    if ($('#centerNowArtist')) $('#centerNowArtist').textContent = artist;
    if ($('#centerMetaTitle')) $('#centerMetaTitle').textContent = title;
    if ($('#centerMetaArtist')) $('#centerMetaArtist').textContent = artist;
    if ($('#centerNowCover')) $('#centerNowCover').src = video.thumbnail || '';
    if ($('#nowTitle')) $('#nowTitle').textContent = title;
    if ($('#nowArtist')) $('#nowArtist').textContent = artist;
    if ($('#nowCover')) $('#nowCover').src = video.thumbnail || '';
  }

  function setPlaying(playing) {
    const value = playing ? '❚❚' : '▶';
    if (playBtn) playBtn.textContent = value;
    if (centerPlayBtn) centerPlayBtn.textContent = value;
  }

  function togglePlay() {
    if (!ytPlayer || !window.YT) return;
    try {
      const state = ytPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    } catch (_) {}
  }

  playBtn?.addEventListener('click', togglePlay);
  centerPlayBtn?.addEventListener('click', togglePlay);
  $('#prevBtn')?.addEventListener('click', () => nextVideo(-1));
  $('#centerPrevBtn')?.addEventListener('click', () => nextVideo(-1));
  $('#nextBtn')?.addEventListener('click', () => nextVideo(1));
  $('#centerNextBtn')?.addEventListener('click', () => nextVideo(1));
  $('#shuffleBtn')?.addEventListener('click', shuffleVideo);
  $('#centerShuffleBtn')?.addEventListener('click', shuffleVideo);

  function toggleRepeat() {
    repeatEnabled = !repeatEnabled;
    $('#repeatBtn')?.classList.toggle('enabled', repeatEnabled);
    $('#centerRepeatBtn')?.classList.toggle('enabled', repeatEnabled);
    toast(repeatEnabled ? '한 곡 반복을 켰습니다.' : '한 곡 반복을 껐습니다.');
  }

  $('#repeatBtn')?.addEventListener('click', toggleRepeat);
  $('#centerRepeatBtn')?.addEventListener('click', toggleRepeat);

  function startProgressTimer() {
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (!ytPlayer) return;
      try {
        updateProgress(Number(ytPlayer.getCurrentTime()) || 0, Number(ytPlayer.getDuration()) || 0);
      } catch (_) {}
    }, 400);
  }

  function updateProgress(current, duration) {
    const pct = duration > 0 ? Math.min(100, Math.max(0, current / duration * 100)) : 0;
    if ($('#curTime')) $('#curTime').textContent = formatTime(current);
    if ($('#duration')) $('#duration').textContent = formatTime(duration);
    if ($('#centerCurTime')) $('#centerCurTime').textContent = formatTime(current);
    if ($('#centerDuration')) $('#centerDuration').textContent = formatTime(duration);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (centerProgressFill) centerProgressFill.style.width = `${pct}%`;
  }

  function seekVideo(event) {
    if (!ytPlayer) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    try { ytPlayer.seekTo(ytPlayer.getDuration() * pct, true); } catch (_) {}
  }

  $('#progressLine')?.addEventListener('click', seekVideo);
  $('#centerProgressLine')?.addEventListener('click', seekVideo);

  function getVolume() { return Number(volume?.value || 0.8); }

  function setVolume(value) {
    value = Math.max(0, Math.min(1, Number(value)));
    if (volume) volume.value = String(value);
    if (centerVolume) centerVolume.value = String(value);
    if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
      try { ytPlayer.setVolume(Math.round(value * 100)); } catch (_) {}
    }
  }

  volume?.addEventListener('input', e => setVolume(e.target.value));
  centerVolume?.addEventListener('input', e => setVolume(e.target.value));

  /* ===================== Search ===================== */

  async function searchYoutube(rawQuery, options = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) { toast('검색어를 입력해 주세요.'); return []; }
    if (!validApiKey()) { toast('YouTube API Key를 넣어주세요.'); return []; }

    const cacheKey = normalizeText(query);
    if (Array.isArray(searchCache[cacheKey])) {
      const cached = searchCache[cacheKey];
      youtubeResults = cached;
      exploreResults = cached;
      lastExploreQuery = query;
      renderExplore();
      if (options.showPanel !== false) renderSearchPanel(query, cached);
      return cached;
    }

    const serial = ++searchSerial;

    try {
      const params = new URLSearchParams({
        part:'snippet',type:'video',q:query,maxResults:'30',videoCategoryId:'10',
        videoEmbeddable:'true',videoSyndicated:'true',safeSearch:'moderate',
        relevanceLanguage:'ko',regionCode:'KR',key:YOUTUBE_API_KEY
      });

      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
      const data = await res.json();
      if (serial !== searchSerial) return [];
      if (!res.ok) throw new Error(data?.error?.message || '검색 오류');

      const results = (data.items || [])
        .filter(item => item?.id?.videoId)
        .map(item => ({
          videoId:item.id.videoId,
          title:decodeHTML(item.snippet?.title || '제목 없음'),
          channelTitle:decodeHTML(item.snippet?.channelTitle || 'YouTube'),
          thumbnail:item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
        }))
        .filter(isSongVideo)
        .slice(0, 18);

      searchCache[cacheKey] = results;
      saveJSON(SEARCH_CACHE_KEY, searchCache, sessionStorage);
      youtubeResults = results;
      exploreResults = results;
      lastExploreQuery = query;
      renderExplore();
      if (options.showPanel !== false) renderSearchPanel(query, results);
      return results;
    } catch (error) {
      console.error(error);
      toast('YouTube 검색에 실패했습니다.');
      return [];
    }
  }

  function renderSearchPanel(query, results) {
    if (!searchPanel) return;
    searchPanel.classList.remove('hidden');
    searchPanel.innerHTML = `
      <div class="search-panel-head">
        <div><strong>“${safe(query)}”</strong><span>노래 검색 결과</span></div>
        <button id="closeSearchPanel" type="button">×</button>
      </div>
      <div class="search-result-list">
        ${results.length ? results.slice(0,10).map((video,index) => `
          <div class="search-result-row">
            <button class="search-result" data-search-index="${index}" type="button">
              <img src="${safe(video.thumbnail)}" alt="">
              <span><strong>${safe(video.title)}</strong><small>${safe(video.channelTitle)}</small></span><b>▶</b>
            </button>
            <button class="search-add-playlist" data-search-add="${index}" type="button" title="재생목록에 추가">＋</button>
          </div>`).join('') : '<div class="search-empty">조건에 맞는 노래를 찾지 못했습니다.</div>'}
      </div>`;

    $('#closeSearchPanel')?.addEventListener('click', closeSearchPanel);
    $$('[data-search-index]', searchPanel).forEach(btn => {
      btn.addEventListener('click', () => {
        const video = results[Number(btn.dataset.searchIndex)];
        if (video) playWithQueue(video, results);
      });
    });
    $$('[data-search-add]', searchPanel).forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const video = results[Number(btn.dataset.searchAdd)];
        if (video) openPlaylistPicker(video);
      });
    });
  }

  function closeSearchPanel() { searchPanel?.classList.add('hidden'); }

  $('#youtubeSearchBtn')?.addEventListener('click', () => searchYoutube(searchInput?.value || ''));
  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); searchYoutube(searchInput.value); }
    if (e.key === 'Escape') closeSearchPanel();
  });

  function renderExplore() {
    const root = $('#exploreResults');
    if (!root) return;
    if ($('#exploreTitle')) $('#exploreTitle').textContent = lastExploreQuery ? `“${lastExploreQuery}” 노래 검색 결과` : '음악 둘러보기';
    if (!exploreResults.length) {
      root.innerHTML = emptyHTML('아직 검색한 음악이 없습니다.', '상단 검색창 또는 분위기 버튼을 사용해 보세요.');
      return;
    }
    root.innerHTML = exploreResults.map(videoCardHTML).join('');
    bindVideoCards(root, exploreResults);
  }

  $$('.category').forEach(btn => {
    btn.addEventListener('click', async () => {
      $$('.category').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      const query = btn.dataset.searchPreset;
      if (!query) { setRoute('home'); return; }
      if (searchInput) searchInput.value = query;
      setRoute('explore');
      await searchYoutube(query, { showPanel:false });
    });
  });

  /* ===================== Start ===================== */

  ensurePlaylistUI();
  createQuickPlaylistButtons();
  setVolume(0.8);
  renderRecent();
  renderLibrary();
  renderPlaylists();
  renderExplore();
  setRoute(getRoute(), false);
  loadRecommendations();
  loadYouTubePlayerAPI();
})();

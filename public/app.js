// Global state
let currentTab = 'tab-parlay';
let leagueMembers = [];
let parlayData = null;
let allPlayers = [];
let filteredPlayers = [];
let selectedPlayerForPick = null;
let selectedMemberForPick = null;
let currentPosFilter = 'ALL';

// Helper to trigger Lucide icon rendering across dynamic DOM elements
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// DOM Elements
const parlayLegsList = document.getElementById('parlay-legs-list');
const playerCardList = document.getElementById('player-card-list');
const leaderboardContainer = document.getElementById('leaderboard-container');
const designatedBettorName = document.getElementById('designated-bettor-name');
const designatedBettorReason = document.getElementById('designated-bettor-reason');
const refreshScoresBtn = document.getElementById('refresh-scores-btn');
const refreshIcon = document.getElementById('refresh-icon');

// Parlay payout elements
const parlayPickedCount = document.getElementById('parlay-picked-count');
const totalParlayOdds = document.getElementById('total-parlay-odds');
const payoutAmount = document.getElementById('payout-amount');
const profitAmount = document.getElementById('profit-amount');
const legsCount = document.getElementById('legs-count');

// Modals
const pickModal = document.getElementById('pick-modal');
const modalPlayerSummary = document.getElementById('modal-player-summary');
const modalMemberList = document.getElementById('modal-member-list');
const confirmPickBtn = document.getElementById('confirm-pick-btn');
const cancelPickBtn = document.getElementById('cancel-pick-btn');
const closePickModal = document.getElementById('close-pick-modal');

const bettorModal = document.getElementById('bettor-modal');
const openBettorModal = document.getElementById('open-bettor-modal');
const closeBettorModal = document.getElementById('close-bettor-modal');
const cancelBettorBtn = document.getElementById('cancel-bettor-btn');
const saveBettorBtn = document.getElementById('save-bettor-btn');
const adminBettorSelect = document.getElementById('admin-bettor-select');
const adminBettorReason = document.getElementById('admin-bettor-reason');
const adminTdSimList = document.getElementById('admin-td-sim-list');

// Profile Edit Modal
const editProfileModal = document.getElementById('edit-profile-modal');
const closeProfileModal = document.getElementById('close-profile-modal');
const cancelProfileBtn = document.getElementById('cancel-profile-btn');
const saveProfileBtn = document.getElementById('save-profile-btn');
const profilePreviewImg = document.getElementById('profile-preview-img');
const profileMemberOwnerName = document.getElementById('profile-member-owner-name');
const profileTeamNameInput = document.getElementById('profile-team-name-input');
const profileImageInput = document.getElementById('profile-image-input');
const profileImageUrlInput = document.getElementById('profile-image-url-input');
const applyUrlIconBtn = document.getElementById('apply-url-icon-btn');
let activeEditingMemberId = null;
let currentEditingImageData = null;

// Search & Filter
const playerSearch = document.getElementById('player-search');
const clearSearch = document.getElementById('clear-search');
const posPills = document.querySelectorAll('.pill-btn');
const playerCountDisplay = document.getElementById('player-count-display');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadInitialData();
  refreshIcons();
});

// Setup Tab Switching
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.target === tabId) {
      btn.classList.add('active');
    }
  });

  const activePane = document.getElementById(tabId);
  if (activePane) {
    activePane.classList.add('active');
  }

  // Reload or refresh specific views on tab open
  if (tabId === 'tab-parlay') {
    loadParlayData();
  } else if (tabId === 'tab-players') {
    loadPlayersData();
  } else if (tabId === 'tab-stats') {
    loadStatsData();
  }
}

// Initial Data Loading
async function loadInitialData() {
  await Promise.all([
    loadMembers(),
    loadParlayData()
  ]);
  refreshIcons();
}

// Fetch Members
async function loadMembers() {
  try {
    const res = await fetch('/api/members');
    const data = await res.json();
    leagueMembers = data.members || [];
  } catch (err) {
    console.error('Failed to load members:', err);
  }
}

// Fetch Parlay & Render
async function loadParlayData() {
  try {
    const res = await fetch('/api/parlay');
    parlayData = await res.json();
    renderParlayTab(parlayData);
  } catch (err) {
    parlayLegsList.innerHTML = `<div class="loading-state">Failed to load parlay data.</div>`;
    console.error(err);
  }
}

// Render Parlay Tab
function renderParlayTab(data) {
  // Update Header & Bettor
  document.getElementById('current-week-tag').innerHTML = `<span class="pulse-dot"></span> Week ${data.week}`;
  const bettorDisplayName = data.bettor ? (data.bettor.teamName ? `${data.bettor.teamName} (${data.bettor.fullName || data.bettor.name})` : data.bettor.name) : 'Not set';
  designatedBettorName.textContent = bettorDisplayName;
  designatedBettorReason.textContent = data.bettorReason || 'Least fantasy points scored in previous week';

  // Update Payout Card
  const parlay = data.parlay || {};
  parlayPickedCount.textContent = data.picksCount;
  totalParlayOdds.textContent = parlay.totalOddsAmerican || '+0';
  payoutAmount.textContent = `$${parlay.payout || '10.00'}`;
  profitAmount.textContent = `$${parlay.profit || '0.00'}`;
  legsCount.textContent = `${data.picksCount}/10`;

  // Render 10 Legs
  parlayLegsList.innerHTML = '';
  data.members.forEach(member => {
    const card = document.createElement('div');
    const pick = member.pick;
    const hasPicked = member.hasPicked;
    const memberImg = member.image || `/images/${member.id}.png`;

    if (hasPicked) {
      const isScored = pick.hasScored;
      card.className = `leg-card ${isScored ? 'scored' : ''}`;
      card.innerHTML = `
        <div class="leg-card-left">
          <div class="member-avatar ${member.isAdmin ? 'admin' : ''}" onclick="openProfileModal('${member.id}')" title="Click to edit team profile">
            <img src="${memberImg}" alt="${member.name}" class="member-avatar-img" onerror="this.onerror=null; this.src='/images/${member.id}.png';">
            <div class="avatar-edit-hint"><i data-lucide="edit-2" style="width:10px; height:10px;"></i></div>
          </div>
          <div class="member-info">
            <div class="member-name-row">
              <span class="member-name clickable" onclick="openProfileModal('${member.id}')" title="Click to edit team name">
                ${member.teamName || member.name}
              </span>
              <button class="member-profile-edit-btn" onclick="openProfileModal('${member.id}')" title="Edit team name & icon">
                <i data-lucide="edit-3" style="width:12px; height:12px;"></i>
              </button>
            </div>
            <div class="member-subname">${member.fullName ? `${member.fullName}` : member.name}</div>
            <div class="player-picked-row">
              <img src="${pick.player.headshot}" class="player-headshot-tiny" onerror="this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/default.png'" alt="${pick.player.name}">
              <span class="player-picked-name">${pick.player.name}</span>
              <span class="player-picked-meta">${pick.player.position} - ${pick.player.team} (${pick.player.matchup})</span>
            </div>
            ${pick.scoringPlay ? `<div style="font-size:10px; color:#22c55e; margin-top:2px; display:flex; align-items:center; gap:4px;"><i data-lucide="check-circle-2" style="width:12px; height:12px;"></i> ${pick.scoringPlay}</div>` : ''}
          </div>
        </div>
        <div class="leg-card-right">
          <span class="odds-tag">${pick.player.odds}</span>
          <span class="status-badge ${isScored ? 'scored' : 'pending'}">
            ${isScored ? '<i data-lucide="check" style="width:12px; height:12px;"></i> TD SCORED!' : 'PENDING'}
          </span>
          <button class="delete-pick-btn" onclick="removePick('${member.id}', '${member.name}')" title="Remove pick">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
          </button>
        </div>
      `;
    } else {
      card.className = 'leg-card empty';
      card.innerHTML = `
        <div class="leg-card-left">
          <div class="member-avatar ${member.isAdmin ? 'admin' : ''}" onclick="openProfileModal('${member.id}')" title="Click to edit team profile">
            <img src="${memberImg}" alt="${member.name}" class="member-avatar-img" onerror="this.onerror=null; this.src='/images/${member.id}.png';">
            <div class="avatar-edit-hint"><i data-lucide="edit-2" style="width:10px; height:10px;"></i></div>
          </div>
          <div class="member-info">
            <div class="member-name-row">
              <span class="member-name clickable" onclick="openProfileModal('${member.id}')" title="Click to edit team name">
                ${member.teamName || member.name}
              </span>
              <button class="member-profile-edit-btn" onclick="openProfileModal('${member.id}')" title="Edit team name & icon">
                <i data-lucide="edit-3" style="width:12px; height:12px;"></i>
              </button>
            </div>
            <div class="member-subname">${member.fullName ? `${member.fullName} (${member.name})` : member.name}</div>
            <div class="no-pick-label">Has not selected a player yet</div>
          </div>
        </div>
        <div class="leg-card-right">
          <span class="status-badge unpicked">NO PICK</span>
          <button class="btn btn-add-pick" style="margin-top:4px;" onclick="goToPlayerListForMember('${member.id}')">
            <i data-lucide="plus" style="width:13px; height:13px;"></i> Pick
          </button>
        </div>
      `;
    }
    parlayLegsList.appendChild(card);
  });
  refreshIcons();
}

// Remove Pick
async function removePick(memberId, memberName) {
  if (!confirm(`Are you sure you want to remove ${memberName}'s pick?`)) return;

  try {
    const res = await fetch(`/api/picks/${memberId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Removed pick for ${memberName}`);
      loadParlayData();
    } else {
      showToast(data.error || 'Failed to remove pick');
    }
  } catch (err) {
    showToast('Network error removing pick');
  }
}

// Quick action to jump to player list to make pick for a member
function goToPlayerListForMember(memberId) {
  selectedMemberForPick = memberId;
  switchTab('tab-players');
  showToast(`Choose a player for ${leagueMembers.find(m => m.id === memberId)?.name || 'member'}`);
}

// Fetch and Render Players
async function loadPlayersData() {
  playerCardList.innerHTML = `<div class="loading-state"><i data-lucide="loader-2" class="spin-icon"></i> Fetching NFL rosters & Anytime TD odds...</div>`;
  refreshIcons();
  try {
    const res = await fetch('/api/players');
    const data = await res.json();
    allPlayers = data.players || [];
    applyFilters();
  } catch (err) {
    playerCardList.innerHTML = `<div class="loading-state">Failed to load NFL players. Please retry.</div>`;
    console.error(err);
  }
}

// Filter and search players
function applyFilters() {
  const query = (playerSearch.value || '').trim().toLowerCase();
  
  filteredPlayers = allPlayers.filter(p => {
    // Position filter
    if (currentPosFilter !== 'ALL' && p.position !== currentPosFilter) {
      return false;
    }
    // Search query filter
    if (query) {
      const matchName = p.name.toLowerCase().includes(query);
      const matchTeam = p.teamName.toLowerCase().includes(query) || p.teamAbbr.toLowerCase().includes(query);
      const matchOpp = p.opponent.toLowerCase().includes(query);
      const matchPos = p.position.toLowerCase() === query;
      if (!matchName && !matchTeam && !matchOpp && !matchPos) {
        return false;
      }
    }
    return true;
  });

  playerCountDisplay.textContent = `Showing ${filteredPlayers.length} available players`;
  renderPlayerCards();
}

// Render Player Cards
function renderPlayerCards() {
  if (filteredPlayers.length === 0) {
    playerCardList.innerHTML = `
      <div class="loading-state">
        <i data-lucide="folder-search" style="width:28px; height:28px; margin-bottom:8px;"></i>
        <div>No players found matching filter.</div>
      </div>
    `;
    refreshIcons();
    return;
  }

  // Display top 80 matching for ultra fast render performance, with lazy feel
  const displaySlice = filteredPlayers.slice(0, 80);

  playerCardList.innerHTML = '';
  displaySlice.forEach(player => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-card-left">
        <div class="player-avatar-wrap">
          <img src="${player.headshot}" class="player-headshot" onerror="this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/default.png'" alt="${player.name}">
          <div class="team-badge-overlay">
            <img src="${player.teamLogo}" onerror="this.style.display='none'" alt="${player.teamAbbr}">
          </div>
        </div>
        <div class="player-card-info">
          <div class="player-title-row">
            <span class="player-name">${player.name}</span>
            <span class="player-pos">${player.position}</span>
          </div>
          <div class="player-matchup-row">
            <span>${player.teamAbbr}</span>
            <span>${player.matchup}</span>
          </div>
          <div class="player-game-status">${player.gameStatus}</div>
        </div>
      </div>
      <div class="player-card-right">
        <span class="player-att-odds">${player.odds}</span>
        <button class="btn-add-pick" onclick="openPickModalForPlayer('${player.id}')">
          <i data-lucide="plus" style="width:13px; height:13px;"></i> Add Pick
        </button>
      </div>
    `;
    playerCardList.appendChild(card);
  });
  refreshIcons();
}

// Open Pick Modal
function openPickModalForPlayer(playerId) {
  const player = allPlayers.find(p => String(p.id) === String(playerId));
  if (!player) return;
  selectedPlayerForPick = player;

  // Render player preview
  modalPlayerSummary.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <img src="${player.headshot}" style="width:40px; height:40px; border-radius:8px; object-fit:cover;" onerror="this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/default.png'">
      <div>
        <div style="font-weight:700; color:#fff;">${player.name} (${player.position})</div>
        <div style="font-size:12px; color:#94a3b8;">${player.teamName} ${player.matchup}</div>
      </div>
    </div>
    <div style="font-family:'Teko'; font-size:24px; color:#22c55e; font-weight:700;">
      ${player.odds}
    </div>
  `;

  // Render members list (disable those who have already picked)
  modalMemberList.innerHTML = '';
  const pickedMemberIds = new Set((parlayData?.members || []).filter(m => m.hasPicked).map(m => m.id));

  // Determine pre-selected member if user clicked "Pick" on parlay tab
  if (!selectedMemberForPick || pickedMemberIds.has(selectedMemberForPick)) {
    const firstAvailable = leagueMembers.find(m => !pickedMemberIds.has(m.id));
    selectedMemberForPick = firstAvailable ? firstAvailable.id : null;
  }

  leagueMembers.forEach(m => {
    const alreadyPicked = pickedMemberIds.has(m.id);
    const memberImg = m.image || `/images/${m.id}.png`;
    const option = document.createElement('div');
    option.className = `member-select-option ${alreadyPicked ? 'disabled' : ''} ${selectedMemberForPick === m.id && !alreadyPicked ? 'selected' : ''}`;
    option.innerHTML = `
      <img src="${memberImg}" class="member-modal-avatar-img" alt="${m.name}" onerror="this.onerror=null; this.src='/images/${m.id}.png';">
      <div style="display:flex; flex-direction:column; min-width:0; flex:1;">
        <div style="font-weight:700; color:${alreadyPicked ? '#64748b' : '#fff'}; font-size:12px; display:flex; align-items:center; gap:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${m.teamName || m.name} ${m.isAdmin ? '<i data-lucide="crown" style="width:11px; height:11px; color:#f59e0b; flex-shrink:0;"></i>' : ''}
        </div>
        <div style="font-size:10px; color:#94a3b8;">${m.fullName || m.name}</div>
      </div>
      ${alreadyPicked ? '<span style="font-size:9px; color:#ef4444; margin-left:auto; font-weight:700; flex-shrink:0;">PICKED</span>' : ''}
    `;

    if (!alreadyPicked) {
      option.addEventListener('click', () => {
        selectedMemberForPick = m.id;
        document.querySelectorAll('.member-select-option').forEach(el => el.classList.remove('selected'));
        option.classList.add('selected');
        confirmPickBtn.disabled = false;
      });
    }

    modalMemberList.appendChild(option);
  });

  confirmPickBtn.disabled = !selectedMemberForPick || pickedMemberIds.has(selectedMemberForPick);
  pickModal.classList.add('open');
  refreshIcons();
}

// Confirm Add Pick
async function confirmPick() {
  if (!selectedPlayerForPick || !selectedMemberForPick) return;

  confirmPickBtn.disabled = true;
  confirmPickBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon" style="width:14px; height:14px;"></i> Locking in...';
  refreshIcons();

  try {
    const res = await fetch('/api/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: selectedMemberForPick,
        playerId: selectedPlayerForPick.id
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      pickModal.classList.remove('open');
      selectedPlayerForPick = null;
      selectedMemberForPick = null;
      // Refresh parlay and available players list
      await loadParlayData();
      await loadPlayersData();
      switchTab('tab-parlay');
    } else {
      showToast(data.error || 'Failed to lock in pick');
    }
  } catch (err) {
    showToast('Network error locking pick');
  } finally {
    confirmPickBtn.disabled = false;
    confirmPickBtn.innerHTML = '<i data-lucide="lock" style="width:14px; height:14px;"></i> Add to Parlay';
    refreshIcons();
  }
}

// Refresh live scoring status
async function refreshScores() {
  if (refreshIcon) refreshIcon.classList.add('spin-icon');
  refreshScoresBtn.disabled = true;

  try {
    const res = await fetch('/api/parlay/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Scoring refreshed: ${data.scoredCount} of ${data.totalPicks} legs scored!`);
      await loadParlayData();
    } else {
      showToast(data.message || 'Scoring checked');
    }
  } catch (err) {
    showToast('Error refreshing live scores');
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('spin-icon');
    refreshScoresBtn.disabled = false;
    refreshIcons();
  }
}

// Admin Bettor Modal
function openAdminBettorModal() {
  // Populate dropdown
  adminBettorSelect.innerHTML = '';
  leagueMembers.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.teamName || m.name} (${m.fullName || m.name})${m.isAdmin ? ' [Admin]' : ''}`;
    if (parlayData?.bettor && parlayData.bettor.id === m.id) {
      opt.selected = true;
    }
    adminBettorSelect.appendChild(opt);
  });

  adminBettorReason.value = parlayData?.bettorReason || 'Scored least fantasy points in previous week';

  // Simulator controls
  renderSimulatorTools();

  bettorModal.classList.add('open');
  refreshIcons();
}

function renderSimulatorTools() {
  adminTdSimList.innerHTML = '';
  if (!parlayData || parlayData.picksCount === 0) {
    adminTdSimList.innerHTML = '<div style="font-size:11px; color:#64748b;">No active picks to simulate. Add picks first.</div>';
    return;
  }

  parlayData.members.filter(m => m.hasPicked).forEach(m => {
    const p = m.pick;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:12px;';
    row.innerHTML = `
      <span>${m.name}: <b>${p.player.name}</b></span>
      <button class="btn" style="padding:4px 8px; font-size:10px; background:${p.hasScored ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}; color:${p.hasScored ? '#f87171' : '#22c55e'};" onclick="simulatePickTD('${m.id}', ${!p.hasScored})">
        ${p.hasScored ? 'Reset to Pending' : 'Simulate TD Scored'}
      </button>
    `;
    adminTdSimList.appendChild(row);
  });
}

// Simulate TD
async function simulatePickTD(memberId, hasScored) {
  try {
    const res = await fetch('/api/admin/simulate-td', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, hasScored })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Simulation updated!`);
      await loadParlayData();
      renderSimulatorTools();
    }
  } catch (err) {
    showToast('Simulation failed');
  }
}

// Save Bettor Changes
async function saveBettorDesignation() {
  const bettorId = adminBettorSelect.value;
  const reason = adminBettorReason.value;

  try {
    const res = await fetch('/api/admin/bettor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bettorId, reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Updated designated bettor!`);
      bettorModal.classList.remove('open');
      await loadParlayData();
    } else {
      showToast(data.error || 'Failed to update bettor');
    }
  } catch (err) {
    showToast('Network error updating bettor');
  }
}

// Open Edit Profile Modal with large team icon
function openProfileModal(memberId) {
  const member = leagueMembers.find(m => m.id === memberId);
  if (!member) return;

  activeEditingMemberId = member.id;
  currentEditingImageData = member.image || `/images/${member.id}.png`;

  profileMemberOwnerName.textContent = `Team of ${member.fullName || member.name} (${member.name})`;
  profileTeamNameInput.value = member.teamName || member.name;
  profilePreviewImg.src = currentEditingImageData;
  profileImageUrlInput.value = '';

  editProfileModal.classList.add('open');
  refreshIcons();
}

// Handle Image File Upload (convert to Data URL)
function handleProfileImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    currentEditingImageData = e.target.result;
    profilePreviewImg.src = currentEditingImageData;
  };
  reader.readAsDataURL(file);
}

// Save Profile Changes (Team Name & Icon)
async function saveTeamProfile() {
  if (!activeEditingMemberId) return;

  const newTeamName = (profileTeamNameInput.value || '').trim();
  if (!newTeamName) {
    showToast('Please enter a team name');
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon" style="width:14px; height:14px;"></i> Saving...';
  refreshIcons();

  try {
    const res = await fetch(`/api/members/${activeEditingMemberId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamName: newTeamName,
        image: currentEditingImageData
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Updated team profile!`);
      editProfileModal.classList.remove('open');
      await loadMembers();
      if (currentTab === 'tab-parlay') await loadParlayData();
      if (currentTab === 'tab-stats') await loadStatsData();
    } else {
      showToast(data.error || 'Failed to update profile');
    }
  } catch (err) {
    showToast('Error saving team profile');
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.innerHTML = '<i data-lucide="save"></i> Save Changes';
    refreshIcons();
  }
}

// Stats & Leaderboard
async function loadStatsData() {
  leaderboardContainer.innerHTML = `<div class="loading-state"><i data-lucide="loader-2" class="spin-icon"></i> Calculating league records...</div>`;
  refreshIcons();
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    renderStatsTab(data);
  } catch (err) {
    leaderboardContainer.innerHTML = `<div class="loading-state">Failed to load league stats.</div>`;
    console.error(err);
  }
}

function renderStatsTab(data) {
  const leaderboard = data.leaderboard || [];
  leaderboardContainer.innerHTML = '';

  leaderboard.forEach((item, index) => {
    const rank = index + 1;
    const card = document.createElement('div');
    card.className = 'member-stat-card';
    const memberImg = item.member.image || `/images/${item.member.id}.png`;
    
    // History list preview
    const historyHtml = (item.history || []).map(h => `
      <div class="history-chip">
        <span style="color:#94a3b8; font-weight:700;">WK ${h.week}</span>
        <span class="history-chip-player">${h.player.name} (${h.player.team})</span>
        <span class="history-chip-tag ${h.result}">
          ${h.result === 'scored' ? 'TD SCORED' : h.result === 'missed' ? 'NO TD' : 'PENDING'}
        </span>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="stat-card-header">
        <div class="stat-card-user">
          <span class="rank-badge ${rank <= 3 ? `top-${rank}` : ''}">#${rank}</span>
          <img src="${memberImg}" class="member-stat-avatar-img clickable" alt="${item.member.name}" onclick="openProfileModal('${item.member.id}')" title="Click to edit profile" onerror="this.onerror=null; this.src='/images/${item.member.id}.png';">
          <div style="display:flex; flex-direction:column;">
            <div class="stat-user-name clickable" onclick="openProfileModal('${item.member.id}')" title="Click to edit team name" style="display:flex; align-items:center; gap:6px;">
              ${item.member.teamName || item.member.name} ${item.member.isAdmin ? '<i data-lucide="crown" style="width:13px; height:13px; color:#f59e0b;"></i>' : ''}
              <button class="member-profile-edit-btn" onclick="openProfileModal('${item.member.id}')"><i data-lucide="edit-3" style="width:11px; height:11px;"></i></button>
            </div>
            <div style="font-size:11px; color:#94a3b8;">${item.member.fullName ? `${item.member.fullName} (${item.member.name})` : item.member.name}</div>
          </div>
        </div>
        <div class="stat-summary-pill">
          ${item.tdsScored} / ${item.tdsScored + item.tdsMissed} (${item.winRate}%)
        </div>
      </div>

      <div class="win-rate-bar-wrap">
        <div class="win-rate-bar-fill" style="width: ${item.winRate}%;"></div>
      </div>

      <div class="stat-details-row">
        <span><b style="color:#22c55e;">${item.tdsScored}</b> TDs Hit</span>
        <span><b style="color:#ef4444;">${item.tdsMissed}</b> Missed</span>
        <span><b style="color:#94a3b8;">${item.pending}</b> Pending</span>
        <span><b style="color:#fff;">${item.totalPicks}</b> Total Picks</span>
      </div>

      <div class="history-chips-list">
        ${historyHtml || '<div style="font-size:11px; color:#64748b; text-align:center;">No picks on record yet</div>'}
      </div>
    `;

    leaderboardContainer.appendChild(card);
  });
  refreshIcons();
}

// Toast notification helper
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `<i data-lucide="info" style="width:16px; height:16px; color:#22c55e;"></i> ${msg}`;
  toast.classList.add('show');
  refreshIcons();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Event Listeners setup
function setupEventListeners() {
  refreshScoresBtn.addEventListener('click', refreshScores);

  // Search & Position filters
  playerSearch.addEventListener('input', () => {
    clearSearch.style.display = playerSearch.value ? 'block' : 'none';
    applyFilters();
  });

  clearSearch.addEventListener('click', () => {
    playerSearch.value = '';
    clearSearch.style.display = 'none';
    applyFilters();
  });

  posPills.forEach(pill => {
    pill.addEventListener('click', () => {
      posPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentPosFilter = pill.dataset.pos;
      applyFilters();
    });
  });

  // Pick Modal
  closePickModal.addEventListener('click', () => pickModal.classList.remove('open'));
  cancelPickBtn.addEventListener('click', () => pickModal.classList.remove('open'));
  confirmPickBtn.addEventListener('click', confirmPick);

  // Bettor Modal
  openBettorModal.addEventListener('click', openAdminBettorModal);
  closeBettorModal.addEventListener('click', () => bettorModal.classList.remove('open'));
  cancelBettorBtn.addEventListener('click', () => bettorModal.classList.remove('open'));
  saveBettorBtn.addEventListener('click', saveBettorDesignation);

  // Profile Modal
  closeProfileModal.addEventListener('click', () => editProfileModal.classList.remove('open'));
  cancelProfileBtn.addEventListener('click', () => editProfileModal.classList.remove('open'));
  saveProfileBtn.addEventListener('click', saveTeamProfile);

  profileImageInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProfileImageFile(e.target.files[0]);
    }
  });

  applyUrlIconBtn.addEventListener('click', () => {
    const url = (profileImageUrlInput.value || '').trim();
    if (url) {
      currentEditingImageData = url;
      profilePreviewImg.src = url;
      showToast('Applied image URL preview');
    }
  });
}

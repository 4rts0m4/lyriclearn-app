// ===== CONFIGURATION =====
// IMPORTANT: Replace with your actual Spotify Client ID
const CLIENT_ID = '028b8be0a7eb40aeba632eecd0bf6e97'; // Get from developer.spotify.com
const REDIRECT_URI = window.location.origin + window.location.pathname; // Auto-detect current URL
const SCOPES = 'user-top-read user-read-currently-playing user-read-playback-state';

// ===== STATE MANAGEMENT =====
let accessToken = null;
let currentTrack = null;
let selectedLanguage = 'es';
let wordsLearned = new Set();
let songsExplored = new Set();

// Load saved progress from localStorage
function loadProgress() {
    const saved = localStorage.getItem('lyriclearn_progress');
    if (saved) {
        const data = JSON.parse(saved);
        wordsLearned = new Set(data.words || []);
        songsExplored = new Set(data.songs || []);
        updateProgressDisplay();
    }
}

// Save progress to localStorage
function saveProgress() {
    const data = {
        words: Array.from(wordsLearned),
        songs: Array.from(songsExplored)
    };
    localStorage.setItem('lyriclearn_progress', JSON.stringify(data));
    updateProgressDisplay();
}

// Update progress display
function updateProgressDisplay() {
    document.getElementById('wordsLearned').textContent = wordsLearned.size;
    document.getElementById('songsExplored').textContent = songsExplored.size;
}

// ===== SPOTIFY AUTHENTICATION (PKCE Flow - No Backend Needed) =====

// Generate code verifier and challenge for PKCE
function generateCodeChallenge() {
    const codeVerifier = generateRandomString(128);
    localStorage.setItem('code_verifier', codeVerifier);
    return codeVerifier;
}

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

function base64encode(input) {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function login() {
    const codeVerifier = generateCodeChallenge();
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);
    
    const authUrl = `https://accounts.spotify.com/authorize?` +
        `client_id=${CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent(SCOPES)}&` +
        `code_challenge_method=S256&` +
        `code_challenge=${codeChallenge}`;
    
    window.location.href = authUrl;
}

// Extract authorization code from URL (after redirect)
function getAuthCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('code');
}

// Exchange authorization code for access token
async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
        })
    });
    
    if (!response.ok) {
        throw new Error('Failed to get access token');
    }
    
    const data = await response.json();
    localStorage.removeItem('code_verifier'); // Clean up
    return data.access_token;
}

// ===== SPOTIFY API CALLS =====
async function fetchTopTracks(token) {
    const response = await fetch(
        'https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=medium_term',
        {
            headers: { 'Authorization': `Bearer ${token}` }
        }
    );
    
    if (!response.ok) {
        throw new Error('Failed to fetch tracks');
    }
    
    return response.json();
}

// ===== LYRICS FETCHING (LRCLIB API - FREE) =====
async function fetchLyrics(trackName, artistName, duration) {
    try {
        // LRCLIB API - Free, no API key needed
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}&duration=${Math.round(duration / 1000)}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Lyrics not found');
        }
        
        const data = await response.json();
        
        // Return plain lyrics (unsynced for now, synced later)
        return {
            plain: data.plainLyrics || data.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]/g, '').trim() || null,
            synced: data.syncedLyrics || null
        };
    } catch (error) {
        console.error('Error fetching lyrics:', error);
        return null;
    }
}

// ===== TRANSLATION API (Google Translate - Free Public Endpoint) =====
async function translateText(text, targetLang) {
    if (targetLang === 'en') {
        return text; // No translation needed for English
    }
    
    try {
        // Using free Google Translate endpoint
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        // Parse response - Google returns nested arrays
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            return data[0][0][0];
        }
        
        return text; // Fallback to original if translation fails
    } catch (error) {
        console.error('Translation error:', error);
        return text;
    }
}

async function translateLyrics(lyrics, targetLang) {
    if (targetLang === 'en' || !lyrics) {
        return lyrics;
    }
    
    // Split into lines for better translation
    const lines = lyrics.split('\n');
    const translatedLines = [];
    
    // Translate in batches to avoid rate limiting
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
            const translated = await translateText(lines[i], targetLang);
            translatedLines.push(translated);
            
            // Small delay to avoid rate limiting
            if (i % 5 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            translatedLines.push(''); // Keep empty lines
        }
    }
    
    return translatedLines.join('\n');
}

// ===== UI DISPLAY FUNCTIONS =====
function displayTracks(tracks) {
    const container = document.getElementById('topTracks');
    
    container.innerHTML = tracks.map((track, index) => `
        <div class="track-card" onclick="selectTrack('${track.id}', '${escapeHtml(track.name)}', '${escapeHtml(track.artists[0].name)}', ${track.duration_ms})">
            <div class="track-number">${index + 1}</div>
            <div class="track-info">
                <div class="track-name">${escapeHtml(track.name)}</div>
                <div class="track-artist">${track.artists.map(a => escapeHtml(a.name)).join(', ')}</div>
            </div>
        </div>
    `).join('');
}

async function selectTrack(trackId, trackName, artistName, duration) {
    // Update current track
    currentTrack = { id: trackId, name: trackName, artist: artistName, duration: duration };
    
    // Track this song as explored
    songsExplored.add(trackId);
    saveProgress();
    
    // Update UI
    document.getElementById('currentSong').textContent = trackName;
    document.getElementById('currentArtist').textContent = artistName;
    
    // Show lyrics section, hide tracks
    document.getElementById('tracksSection').style.display = 'none';
    document.getElementById('lyricsSection').style.display = 'block';
    
    // Fetch and display lyrics
    showLoading();
    try {
        const lyricsData = await fetchLyrics(trackName, artistName, duration);
        
        if (!lyricsData || !lyricsData.plain) {
            document.getElementById('lyricsContainer').innerHTML = 
                '<p class="lyrics-placeholder">❌ Lyrics not available for this song. Try another one!</p>';
            return;
        }
        
        // Store original English lyrics
        currentTrack.originalLyrics = lyricsData.plain;
        currentTrack.translatedLyrics = null;
        
        // Display original lyrics
        displayLyrics(lyricsData.plain, null);
        
    } catch (error) {
        document.getElementById('lyricsContainer').innerHTML = 
            '<p class="lyrics-placeholder">❌ Could not load lyrics. Try another song.</p>';
    }
}

function displayLyrics(originalLyrics, translatedLyrics) {
    const container = document.getElementById('lyricsContainer');
    
    // If we have translation, show side-by-side
    if (translatedLyrics) {
        const originalLines = originalLyrics.split('\n');
        const translatedLines = translatedLyrics.split('\n');
        
        let html = '<div class="lyrics-dual">';
        html += '<div class="lyrics-column"><h4>Original (English)</h4>';
        
        originalLines.forEach((line, index) => {
            if (line.trim()) {
                const words = line.split(/\b/);
                const clickableWords = words.map(word => {
                    if (/\w{2,}/.test(word)) {
                        return `<span class="word" onclick="showDefinition('${escapeHtml(word)}')">${escapeHtml(word)}</span>`;
                    }
                    return escapeHtml(word);
                }).join('');
                html += `<p>${clickableWords}</p>`;
            } else {
                html += '<p>&nbsp;</p>';
            }
        });
        
        html += '</div><div class="lyrics-column lyrics-translation"><h4>Translation</h4>';
        
        translatedLines.forEach(line => {
            html += `<p>${escapeHtml(line) || '&nbsp;'}</p>`;
        });
        
        html += '</div></div>';
        container.innerHTML = html;
        
    } else {
        // Show only original with clickable words
        const lines = originalLyrics.split('\n');
        let html = '<div class="lyrics-text">';
        
        lines.forEach(line => {
            if (line.trim()) {
                const words = line.split(/\b/);
                const clickableWords = words.map(word => {
                    if (/\w{2,}/.test(word)) {
                        return `<span class="word" onclick="showDefinition('${escapeHtml(word)}')">${escapeHtml(word)}</span>`;
                    }
                    return escapeHtml(word);
                }).join('');
                html += `<p>${clickableWords}</p>`;
            } else {
                html += '<p>&nbsp;</p>';
            }
        });
        
        html += '</div>';
        container.innerHTML = html;
    }
}

async function showDefinition(word) {
    const popup = document.getElementById('definitionPopup');
    const wordElement = document.getElementById('definitionWord');
    const definitionElement = document.getElementById('definitionText');
    
    wordElement.textContent = word;
    definitionElement.textContent = 'Translating...';
    
    popup.classList.add('active');
    
    // Translate word to selected language
    try {
        const translation = await translateText(word, selectedLanguage);
        definitionElement.textContent = translation;
    } catch (error) {
        definitionElement.textContent = 'Error translating. Try again.';
    }
}

async function changeLanguage() {
    selectedLanguage = document.getElementById('languageSelect').value;
    
    // If "Coming Soon" language selected, show alert
    if (['fr', 'de', 'it', 'pt'].includes(selectedLanguage)) {
        alert('⏳ This language is coming soon! For now, only English and Spanish are available.');
        document.getElementById('languageSelect').value = 'es';
        selectedLanguage = 'es';
        return;
    }
    
    // If we have original lyrics and not English, translate
    if (currentTrack && currentTrack.originalLyrics && selectedLanguage !== 'en') {
        showLoading();
        
        try {
            const translated = await translateLyrics(currentTrack.originalLyrics, selectedLanguage);
            currentTrack.translatedLyrics = translated;
            displayLyrics(currentTrack.originalLyrics, translated);
        } catch (error) {
            alert('Translation failed. Showing original lyrics only.');
            displayLyrics(currentTrack.originalLyrics, null);
        }
    } else if (currentTrack && currentTrack.originalLyrics) {
        // Show only English
        displayLyrics(currentTrack.originalLyrics, null);
    }
}

function backToTracks() {
    document.getElementById('lyricsSection').style.display = 'none';
    document.getElementById('tracksSection').style.display = 'block';
}

// ===== UTILITY FUNCTIONS =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.getElementById('lyricsContainer').innerHTML = 
        '<p class="lyrics-placeholder">⏳ Cargando letras...</p>';
}

function showError(message) {
    alert('❌ Error: ' + message);
}

// ===== MAIN INITIALIZATION =====
async function init() {
    // Load saved progress
    loadProgress();
    
    // Check for authorization code in URL
    const code = getAuthCodeFromUrl();
    
    if (code) {
        // Clear code from URL for security
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Hide auth section, show loading
        document.getElementById('authSection').style.display = 'none';
        document.getElementById('loading').style.display = 'block';
        
        try {
            // Exchange code for access token
            accessToken = await getAccessToken(code);
            
            // Fetch user's top tracks
            const data = await fetchTopTracks(accessToken);
            
            // Hide loading, show content
            document.getElementById('loading').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            
            // Display tracks
            displayTracks(data.items);
            
        } catch (error) {
            showError('No se pudieron cargar tus canciones. Intenta nuevamente.');
            document.getElementById('loading').style.display = 'none';
            document.getElementById('authSection').style.display = 'block';
        }
    } else {
        // Show login screen
        document.getElementById('authSection').style.display = 'block';
    }
}

// Run initialization when page loads
window.onload = init;
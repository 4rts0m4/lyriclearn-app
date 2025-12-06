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

// ===== LYRICS FETCHING (Mock for MVP) =====
// Note: In production, you'd use Musixmatch API or similar
async function fetchLyrics(trackName, artistName) {
    // Mock lyrics for demonstration
    // In production: Call lyrics API here
    
    const mockLyrics = `Esta es una letra de ejemplo para "${trackName}"
    
Verso 1:
Esta aplicación te ayuda a aprender
Nuevas palabras mientras escuchas música
Haz clic en cualquier palabra para ver
Su significado y traducción

Coro:
LyricLearn hace el aprendizaje divertido
Combina música con educación
Cada canción es una oportunidad
Para expandir tu vocabulario

Verso 2:
Las palabras están a un clic de distancia
Aprende mientras disfrutas tu playlist
Esta es la manera moderna
De dominar un nuevo idioma`;

    return mockLyrics;
}

// ===== TRANSLATION API (Mock for MVP) =====
// Note: In production, use Google Translate API or similar
async function translateWord(word, targetLang) {
    // Mock translations
    const translations = {
        'es': {
            'learning': 'aprendizaje',
            'music': 'música',
            'word': 'palabra',
            'song': 'canción',
            'fun': 'divertido',
            'example': 'ejemplo',
            'application': 'aplicación',
            'help': 'ayuda',
            'new': 'nuevo',
            'listen': 'escuchar'
        },
        'en': {
            'aprendizaje': 'learning',
            'música': 'music',
            'palabra': 'word',
            'canción': 'song',
            'divertido': 'fun',
            'ejemplo': 'example',
            'aplicación': 'application',
            'ayuda': 'help',
            'nuevo': 'new',
            'escuchar': 'listen'
        }
    };
    
    const lowerWord = word.toLowerCase();
    return translations[targetLang]?.[lowerWord] || `[Traducción de "${word}" a ${targetLang}]`;
}

// ===== UI DISPLAY FUNCTIONS =====
function displayTracks(tracks) {
    const container = document.getElementById('topTracks');
    
    container.innerHTML = tracks.map((track, index) => `
        <div class="track-card" onclick="selectTrack('${track.id}', '${escapeHtml(track.name)}', '${escapeHtml(track.artists[0].name)}')">
            <div class="track-number">${index + 1}</div>
            <div class="track-info">
                <div class="track-name">${escapeHtml(track.name)}</div>
                <div class="track-artist">${track.artists.map(a => escapeHtml(a.name)).join(', ')}</div>
            </div>
        </div>
    `).join('');
}

async function selectTrack(trackId, trackName, artistName) {
    // Update current track
    currentTrack = { id: trackId, name: trackName, artist: artistName };
    
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
        const lyrics = await fetchLyrics(trackName, artistName);
        displayLyrics(lyrics);
    } catch (error) {
        document.getElementById('lyricsContainer').innerHTML = 
            '<p class="lyrics-placeholder">❌ No se pudieron cargar las letras. Intenta con otra canción.</p>';
    }
}

function displayLyrics(lyrics) {
    const container = document.getElementById('lyricsContainer');
    
    // Split into words and make them clickable
    const words = lyrics.split(/\b/);
    const clickableWords = words.map(word => {
        // Only make actual words clickable (not spaces or punctuation)
        if (/\w{2,}/.test(word)) {
            return `<span class="word" onclick="showDefinition('${escapeHtml(word)}')">${escapeHtml(word)}</span>`;
        }
        return escapeHtml(word);
    }).join('');
    
    container.innerHTML = `<div class="lyrics-text">${clickableWords}</div>`;
}

async function showDefinition(word) {
    const popup = document.getElementById('definitionPopup');
    const wordElement = document.getElementById('definitionWord');
    const definitionElement = document.getElementById('definitionText');
    
    wordElement.textContent = word;
    definitionElement.textContent = 'Traduciendo...';
    
    popup.classList.add('active');
    
    // Fetch translation
    try {
        const translation = await translateWord(word, selectedLanguage);
        definitionElement.textContent = translation;
    } catch (error) {
        definitionElement.textContent = 'Error al traducir. Intenta de nuevo.';
    }
}

function closeDefinition() {
    document.getElementById('definitionPopup').classList.remove('active');
}

function saveWord() {
    const word = document.getElementById('definitionWord').textContent;
    wordsLearned.add(word);
    saveProgress();
    
    // Show feedback
    alert(`✅ Palabra "${word}" guardada!`);
    closeDefinition();
}

function changeLanguage() {
    selectedLanguage = document.getElementById('languageSelect').value;
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
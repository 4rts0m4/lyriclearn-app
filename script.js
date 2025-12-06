// ===== CONFIGURACION =====
const CLIENT_ID = '028b8be0a7eb40aeba632eecd0bf6e97'; // Profesor, para recrear, debe reemplazar con su Client ID
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-top-read user-read-currently-playing user-read-playback-state';

// ===== COMPONENTE PRINCIPAL ALPINE.JS =====
function lyricLearnApp() {
    return {
        // Estado de autenticacion
        isAuthenticated: false,
        accessToken: null,
        loading: false,
        
        // Datos de canciones
        tracks: [],
        selectedTrack: null,
        
        // Letras
        currentLyrics: null,
        translatedLyrics: null,
        lyricsLoading: false,
        selectedLanguage: 'en',
        
        // Modal de definicion
        showDefinitionModal: false,
        selectedWord: '',
        wordDefinition: '',
        
        // Progreso del usuario
        wordsLearned: new Set(),
        songsExplored: new Set(),

        // ===== INICIALIZACION =====
        async init() {
            this.loadProgress();
            
            const code = this.getAuthCode();
            if (code) {
                window.history.replaceState({}, document.title, window.location.pathname);
                await this.handleAuth(code);
            }
        },

        // ===== AUTENTICACION SPOTIFY (PKCE) =====
        async login() {
            const verifier = this.generateRandomString(128);
            localStorage.setItem('code_verifier', verifier);
            
            const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
            const challenge = btoa(String.fromCharCode(...new Uint8Array(hashed)))
                .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            
            const url = `https://accounts.spotify.com/authorize?` +
                `client_id=${CLIENT_ID}&` +
                `response_type=code&` +
                `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
                `scope=${encodeURIComponent(SCOPES)}&` +
                `code_challenge_method=S256&` +
                `code_challenge=${challenge}`;
            
            window.location.href = url;
        },

        getAuthCode() {
            return new URLSearchParams(window.location.search).get('code');
        },

        async handleAuth(code) {
            this.loading = true;
            
            try {
                // Obtener access token
                const verifier = localStorage.getItem('code_verifier');
                const response = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: CLIENT_ID,
                        grant_type: 'authorization_code',
                        code: code,
                        redirect_uri: REDIRECT_URI,
                        code_verifier: verifier,
                    })
                });
                
                const data = await response.json();
                this.accessToken = data.access_token;
                localStorage.removeItem('code_verifier');
                
                // Obtener top canciones
                await this.fetchTopTracks();
                
                this.isAuthenticated = true;
            } catch (error) {
                alert('Error al autenticar: ' + error.message);
            } finally {
                this.loading = false;
            }
        },

        // ===== SPOTIFY API =====
        async fetchTopTracks() {
            const response = await fetch(
                'https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=medium_term',
                { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
            );
            
            const data = await response.json();
            this.tracks = data.items;
        },

        // ===== MANEJO DE CANCIONES =====
        async selectTrack(track) {
            this.selectedTrack = {
                id: track.id,
                name: track.name,
                artist: track.artists[0].name,
                duration: track.duration_ms
            };
            
            this.songsExplored.add(track.id);
            this.saveProgress();
            
            // Obtener letras
            this.lyricsLoading = true;
            this.currentLyrics = null;
            this.translatedLyrics = null;
            
            try {
                const lyrics = await this.fetchLyrics(track.name, track.artists[0].name, track.duration_ms);
                if (lyrics?.plain) {
                    this.currentLyrics = lyrics.plain;
                }
            } catch (error) {
                console.error('Error al obtener letras:', error);
            } finally {
                this.lyricsLoading = false;
            }
        },

        backToTracks() {
            this.selectedTrack = null;
            this.currentLyrics = null;
            this.translatedLyrics = null;
            this.selectedLanguage = 'en';
        },

        // ===== API DE LETRAS (LRCLIB) =====
        async fetchLyrics(trackName, artistName, duration) {
            const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}&duration=${Math.round(duration / 1000)}`;
            
            const response = await fetch(url);
            if (!response.ok) return null;
            
            const data = await response.json();
            return {
                plain: data.plainLyrics || data.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]/g, '').trim() || null,
                synced: data.syncedLyrics || null
            };
        },

        // ===== TRADUCCION =====
        async changeLanguage() {
            // Validar idiomas no disponibles
            if (['fr', 'de', 'it', 'pt'].includes(this.selectedLanguage)) {
                alert('⏳ Este idioma estara disponible proximamente!');
                this.selectedLanguage = 'es';
                return;
            }

            // Si es ingles, mostrar solo original
            if (this.selectedLanguage === 'en') {
                this.translatedLyrics = null;
                return;
            }

            // Traducir letras
            if (this.currentLyrics) {
                this.lyricsLoading = true;
                try {
                    this.translatedLyrics = await this.translateLyrics(this.currentLyrics);
                } catch (error) {
                    alert('Error al traducir. Mostrando solo original.');
                    this.translatedLyrics = null;
                } finally {
                    this.lyricsLoading = false;
                }
            }
        },

        async translateLyrics(lyrics) {
            const lines = lyrics.split('\n');
            const translated = [];
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim()) {
                    const result = await this.translateText(lines[i], this.selectedLanguage);
                    translated.push(result);
                    
                    // Delay para evitar rate limiting
                    if (i % 5 === 0 && i > 0) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                } else {
                    translated.push('');
                }
            }
            
            return translated.join('\n');
        },

        async translateText(text, targetLang) {
            if (targetLang === 'en') return text;
            
            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
                const response = await fetch(url);
                const data = await response.json();
                
                return data?.[0]?.[0]?.[0] || text;
            } catch (error) {
                return text;
            }
        },

        // ===== PALABRAS CLICKEABLES =====
        makeWordsClickable(line) {
            if (!line.trim()) return '&nbsp;';
            
            // Dividir por limites de palabra pero mantener espacios
            const parts = line.split(/(\b\w{2,}\b)/g);
            
            return parts.map(part => {
                // Si es una palabra (2+ caracteres alfanumericos)
                if (/^\w{2,}$/.test(part)) {
                    return `<span class="word" @click="showDefinition('${this.escapeHtml(part)}')">${this.escapeHtml(part)}</span>`;
                }
                return this.escapeHtml(part);
            }).join('');
        },

        // ===== DEFINICIONES =====
        async showDefinition(word) {
            this.selectedWord = word;
            this.wordDefinition = 'Traduciendo...';
            this.showDefinitionModal = true;
            
            this.wordDefinition = await this.translateText(word, this.selectedLanguage);
        },

        saveWord() {
            this.wordsLearned.add(this.selectedWord);
            this.saveProgress();
            this.showDefinitionModal = false;
            alert(`✅ Palabra "${this.selectedWord}" guardada!`);
        },

        // ===== PROGRESO =====
        loadProgress() {
            const saved = localStorage.getItem('lyriclearn_progress');
            if (saved) {
                const data = JSON.parse(saved);
                this.wordsLearned = new Set(data.words || []);
                this.songsExplored = new Set(data.songs || []);
            }
        },

        saveProgress() {
            localStorage.setItem('lyriclearn_progress', JSON.stringify({
                words: Array.from(this.wordsLearned),
                songs: Array.from(this.songsExplored)
            }));
        },

        // ===== UTILIDADES =====
        generateRandomString(length) {
            const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            const values = crypto.getRandomValues(new Uint8Array(length));
            return values.reduce((acc, x) => acc + possible[x % possible.length], "");
        },

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }
}
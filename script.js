// config de la app de Spotify
const CLIENT_ID = '028b8be0a7eb40aeba632eecd0bf6e97';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-top-read';

// variables globales
let accessToken = null;
let cancionActual = null;
let letraOriginal = '';
let cancionesVistas = new Set();

// cargar el progreso guardado en localStorage
function cargarProgreso() {
    const guardado = localStorage.getItem('lyriclearn_data');
    if (guardado) {
        const datos = JSON.parse(guardado);
        cancionesVistas = new Set(datos.canciones || []);
        actualizarProgreso();
    }
}

// guardar en localStorage
function guardarProgreso() {
    localStorage.setItem('lyriclearn_data', JSON.stringify({
        canciones: Array.from(cancionesVistas)
    }));
    actualizarProgreso();
}

// actualizar el numero de canciones vistas
function actualizarProgreso() {
    document.getElementById('songsExplored').textContent = cancionesVistas.size;
}

// generar codigo random para el PKCE flow
function generarCodigo(largo) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const valores = crypto.getRandomValues(new Uint8Array(largo));
    return valores.reduce((acc, x) => acc + chars[x % chars.length], "");
}

// hash SHA-256 del code verifier
async function crearHash(codigo) {
    const datos = new TextEncoder().encode(codigo);
    const hash = await crypto.subtle.digest('SHA-256', datos);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// redirect a Spotify para login
async function login() {
    const verificador = generarCodigo(64);
    const desafio = await crearHash(verificador);
    
    localStorage.setItem('code_verifier', verificador);
    
    const url = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&code_challenge_method=S256&code_challenge=${desafio}`;
    
    window.location.href = url;
}

// exchange el code por access token
async function obtenerToken(codigo) {
    const verificador = localStorage.getItem('code_verifier');
    
    const respuesta = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: codigo,
            redirect_uri: REDIRECT_URI,
            code_verifier: verificador
        })
    });
    
    return respuesta.json();
}

// traer top tracks del usuario
async function obtenerCanciones(token) {
    const respuesta = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!respuesta.ok) throw new Error('Error al cargar canciones');
    return respuesta.json();
}

// traer la letra usando lyrics.ovh
async function obtenerLetra(cancion, artista) {
    try {
        const respuesta = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(cancion)}`);
        
        if (!respuesta.ok) {
            throw new Error('Letra no encontrada');
        }
        
        const datos = await respuesta.json();
        return datos.lyrics;
    } catch (error) {
        console.error('Error obteniendo letra:', error);
        throw error;
    }
}

// traducir en bloques para no saturar la API
async function traducirTexto(texto, idiomaDestino) {
    try {
        const lineas = texto.split('\n');
        const traducidas = [];
        
        // traducir de a 10 lineas
        for (let i = 0; i < lineas.length; i += 10) {
            const bloque = lineas.slice(i, i + 10).join('\n');
            if (!bloque.trim()) {
                traducidas.push('');
                continue;
            }
            
            const respuesta = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(bloque)}&langpair=en|${idiomaDestino}`);
            const datos = await respuesta.json();
            
            if (datos.responseStatus === 200) {
                traducidas.push(datos.responseData.translatedText);
            } else {
                traducidas.push(bloque);
            }
            
            // delay para no hacer spam a la API
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        return traducidas.join('\n');
    } catch (error) {
        return texto;
    }
}

// renderizar las cards de canciones
function mostrarCanciones(canciones) {
    const contenedor = document.getElementById('topTracks');
    
    contenedor.innerHTML = canciones.map((cancion, i) => {
        return `
            <div class="track-card" 
                 data-track-id="${cancion.id}" 
                 data-track-uri="${cancion.uri}"
                 data-track-name="${escapar(cancion.name)}" 
                 data-artist-name="${escapar(cancion.artists[0].name)}"
                 onclick="seleccionarCancionPorElemento(this)">
                <div class="track-number">${i + 1}</div>
                <div class="track-info">
                    <div class="track-name">${escapar(cancion.name)}</div>
                    <div class="track-artist">${cancion.artists.map(a => escapar(a.name)).join(', ')}</div>
                </div>
            </div>
        `;
    }).join('');
}

// wrapper para pasar los datos desde el onclick del elemento
async function seleccionarCancionPorElemento(elemento) {
    const id = elemento.dataset.trackId;
    const uri = elemento.dataset.trackUri;
    const nombre = elemento.dataset.trackName;
    const artista = elemento.dataset.artistName;
    
    await seleccionarCancion(id, uri, nombre, artista);
}

// cuando el usuario hace click en una cancion
async function seleccionarCancion(id, uri, nombre, artista) {
    cancionActual = { id, uri, nombre, artista };
    cancionesVistas.add(id);
    guardarProgreso();
    
    document.getElementById('currentSong').textContent = nombre;
    document.getElementById('currentArtist').textContent = artista;
    
    mostrarReproductor(uri);
    
    // cambiar de vista
    document.getElementById('tracksSection').style.display = 'none';
    document.getElementById('lyricsSection').style.display = 'block';
    
    mostrarCargando();
    
    try {
        const letra = await obtenerLetra(nombre, artista);
        letraOriginal = letra;
        await mostrarLetraComparativa(letra);
    } catch (error) {
        console.error('Error cargando letra:', error);
        document.getElementById('lyricsOriginal').innerHTML = 
            '<p class="lyrics-placeholder">❌ No se pudo cargar la letra. Intenta con otra cancion.</p>';
        document.getElementById('lyricsTranslated').innerHTML = 
            '<p class="lyrics-placeholder">❌ No se pudo cargar la traduccion.</p>';
    }
}

// meter el iframe de Spotify
function mostrarReproductor(uri) {
    const contenedor = document.getElementById('spotifyPlayer');
    const trackId = uri.split(':')[2];
    
    contenedor.innerHTML = `
        <iframe 
            style="border-radius:12px" 
            src="https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0" 
            width="100%" 
            height="152" 
            frameBorder="0" 
            allowfullscreen="" 
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
            loading="lazy">
        </iframe>
    `;
}

// mostrar letra original y traducida lado a lado
async function mostrarLetraComparativa(letra) {
    const idiomaSeleccionado = document.getElementById('languageSelect').value;
    
    // lado izquierdo - letra original
    const contenedorOriginal = document.getElementById('lyricsOriginal');
    contenedorOriginal.innerHTML = `<div class="lyrics-text">${escapar(letra)}</div>`;
    
    // lado derecho - traduccion
    document.getElementById('lyricsTranslated').innerHTML = 
        '<p class="lyrics-placeholder">⏳ Traduciendo letra...</p>';
    
    try {
        const letraTraducida = await traducirTexto(letra, idiomaSeleccionado);
        const contenedorTraducido = document.getElementById('lyricsTranslated');
        contenedorTraducido.innerHTML = `<div class="lyrics-text">${escapar(letraTraducida)}</div>`;
    } catch (error) {
        document.getElementById('lyricsTranslated').innerHTML = 
            '<p class="lyrics-placeholder">❌ Error al traducir</p>';
    }
}

// cuando cambia el idioma del select
async function changeLanguage() {
    if (letraOriginal) {
        document.getElementById('lyricsTranslated').innerHTML = 
            '<p class="lyrics-placeholder">⏳ Traduciendo...</p>';
        
        const idiomaSeleccionado = document.getElementById('languageSelect').value;
        const letraTraducida = await traducirTexto(letraOriginal, idiomaSeleccionado);
        const contenedorTraducido = document.getElementById('lyricsTranslated');
        contenedorTraducido.innerHTML = `<div class="lyrics-text">${escapar(letraTraducida)}</div>`;
    }
}

function backToTracks() {
    document.getElementById('lyricsSection').style.display = 'none';
    document.getElementById('tracksSection').style.display = 'block';
    letraOriginal = '';
    document.getElementById('spotifyPlayer').innerHTML = '';
}

// sanitizar texto para prevenir XSS
function escapar(texto) {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

function mostrarCargando() {
    document.getElementById('lyricsOriginal').innerHTML = 
        '<p class="lyrics-placeholder">⏳ Cargando letra...</p>';
    document.getElementById('lyricsTranslated').innerHTML = 
        '<p class="lyrics-placeholder">⏳ Preparando traduccion...</p>';
}

// entry point
async function init() {
    cargarProgreso();
    
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('code');
    
    if (codigo) {
        // limpiar la URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        document.getElementById('authSection').style.display = 'none';
        document.getElementById('loading').style.display = 'block';
        
        try {
            const tokenData = await obtenerToken(codigo);
            accessToken = tokenData.access_token;
            
            const datos = await obtenerCanciones(accessToken);
            
            document.getElementById('loading').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            
            mostrarCanciones(datos.items);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Error al cargar canciones. Intenta de nuevo.');
            document.getElementById('loading').style.display = 'none';
            document.getElementById('authSection').style.display = 'block';
        }
    } else {
        document.getElementById('authSection').style.display = 'block';
    }
}

window.onload = init;
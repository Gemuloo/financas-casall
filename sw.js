// Service worker mínimo do Painel Gemulo.
// Objetivo único: satisfazer o critério de "instalável" do Chrome/Android
// (precisa de um manifest + um service worker com handler de fetch) e
// deixar o app abrindo mais rápido nas próximas vezes, servindo o HTML/ícones
// do cache quando possível. NÃO armazena dados do Supabase — isso continua
// sempre buscando da rede normalmente.

const CACHE_NAME = 'gemulo-shell-v1';
const ARQUIVOS_DO_SHELL = [
  './gemulo.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_DO_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear chamadas ao Supabase: os dados precisam sempre vir da rede.
  if (url.hostname.endsWith('supabase.co')) return;

  // Para o resto (shell do app), tenta cache primeiro, cai pra rede se não achar.
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});

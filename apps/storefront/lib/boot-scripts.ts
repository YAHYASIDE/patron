/*
 * Tiny scripts the root layout runs in <head>, before the page paints. They
 * live here, not in their client components, because a 'use client' module's
 * exports cannot be read on the server.
 */

/**
 * The opening screen (components/Splash.tsx) plays once per browser session.
 * A tap on it or Escape skips it, even before React has loaded.
 */
export const SPLASH_INIT = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem('patron_splash')){d.classList.add('no-splash');return;}sessionStorage.setItem('patron_splash','1');}catch(e){d.classList.add('no-splash');return;}var skip=function(){d.classList.add('splash-skip');};addEventListener('pointerdown',function(e){if(e.target&&e.target.closest&&e.target.closest('.splash'))skip();},true);addEventListener('keydown',function(e){if(e.key==='Escape')skip();});})();`;

/** Chrome's install event can fire before React loads; keep it for components/InstallPrompt.tsx. */
export const INSTALL_INIT = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__patronInstall=e;window.dispatchEvent(new Event('patron-installable'));});`;

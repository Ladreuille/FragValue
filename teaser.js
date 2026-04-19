/* FragValue teaser helper
   - Local interest tracking (localStorage) tant qu'on n'a pas de table DB
   - Live counter fake-but-plausible pour signaler l'intérêt
   - Active la CTA "Activer les notifications" et la passe en "Enregistré"
*/
(function(){
  const ls = window.localStorage;
  const KEY = 'fv_teaser_interests';

  function readInterests(){
    try { return JSON.parse(ls.getItem(KEY) || '{}') || {}; }
    catch(_){ return {}; }
  }
  function writeInterests(obj){
    try { ls.setItem(KEY, JSON.stringify(obj)); } catch(_){ /* quota */ }
  }
  function markInterest(slug){
    const all = readInterests();
    if (!all[slug]) {
      all[slug] = Date.now();
      writeInterests(all);
    }
    return all[slug];
  }
  function hasInterest(slug){ return !!readInterests()[slug]; }

  /* Counter hash-based seed (deterministe par slug) pour éviter
     un faux chiffre qui change à chaque refresh. */
  function pseudoCount(slug, base, perDay){
    const epochDays = Math.floor(Date.now() / 86400000);
    let h = 0;
    for (let i = 0; i < slug.length; i++) h = ((h<<5)-h) + slug.charCodeAt(i);
    const jitter = Math.abs((h ^ epochDays) % 23);
    const grown = Math.floor(perDay * (epochDays - 19600));
    return base + grown + jitter;
  }

  function initCTA(slug, opts){
    opts = opts || {};
    const btn = document.querySelector('[data-teaser-cta="' + slug + '"]');
    const counter = document.querySelector('[data-teaser-counter="' + slug + '"]');

    if (counter) {
      const n = pseudoCount(slug, opts.base || 40, opts.perDay || 1.2);
      counter.textContent = n.toLocaleString('fr-FR');
    }

    if (!btn) return;

    const setSaved = () => {
      btn.dataset.state = 'saved';
      btn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
        'Intérêt enregistré';
    };

    if (hasInterest(slug)) setSaved();

    btn.addEventListener('click', function(ev){
      if (btn.dataset.state === 'saved') return;
      ev.preventDefault();
      markInterest(slug);
      setSaved();
      if (counter) {
        counter.textContent = (parseInt(counter.textContent.replace(/\D/g,''),10) + 1)
          .toLocaleString('fr-FR');
      }
    });
  }

  window.FVTeaser = { initCTA, markInterest, hasInterest };
})();

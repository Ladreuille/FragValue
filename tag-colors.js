/* FragValue : helper de coloration des tags feedback.
   Utilise par admin/feedback.html et account.html (vue Mes feedbacks).
   - Tags semantiques (urgent, bug-critical, etc.) : couleurs predefinies
   - Tags custom : palette deterministe via hash
   Expose : window.fvTagColor(tag) → { bg, color, border }
*/
(function () {
  if (window.fvTagColor) return;

  const SEMANTIC = {
    // Urgence / criticite
    'urgent':              { bg: 'rgba(255,68,68,.12)',  color: '#ff7a7a', border: 'rgba(255,68,68,.35)' },
    'bug-critical':        { bg: 'rgba(255,68,68,.12)',  color: '#ff7a7a', border: 'rgba(255,68,68,.35)' },
    'bug-mineur':          { bg: 'rgba(255,138,61,.12)', color: '#ff8a3d', border: 'rgba(255,138,61,.35)' },

    // Plateforme
    'mobile':              { bg: 'rgba(99,179,237,.12)', color: '#7fc1f5', border: 'rgba(99,179,237,.35)' },
    'desktop':             { bg: 'rgba(99,179,237,.12)', color: '#7fc1f5', border: 'rgba(99,179,237,.35)' },

    // Performance
    'performance':         { bg: 'rgba(245,200,66,.12)', color: '#f5c842', border: 'rgba(245,200,66,.35)' },

    // Domaines
    'payment':             { bg: 'rgba(45,212,160,.12)', color: '#3edcb1', border: 'rgba(45,212,160,.35)' },
    'auth':                { bg: 'rgba(168,85,247,.12)', color: '#c084fc', border: 'rgba(168,85,247,.35)' },

    // Pertinence / produit
    'feedback-pertinent':  { bg: 'rgba(184,255,87,.12)', color: '#b8ff57', border: 'rgba(184,255,87,.35)' },
    'feature-pro':         { bg: 'rgba(184,255,87,.12)', color: '#b8ff57', border: 'rgba(184,255,87,.35)' },
    'feature-team':        { bg: 'rgba(245,200,66,.12)', color: '#f5c842', border: 'rgba(245,200,66,.35)' },

    // Statut / a faire
    'a-creuser':           { bg: 'rgba(122,128,128,.15)', color: '#a8b0b0', border: 'rgba(122,128,128,.35)' },
  };

  // Palette deterministe pour les tags non listes (hash → index)
  const FALLBACK = [
    { bg: 'rgba(99,179,237,.12)', color: '#7fc1f5', border: 'rgba(99,179,237,.35)' },
    { bg: 'rgba(168,85,247,.12)', color: '#c084fc', border: 'rgba(168,85,247,.35)' },
    { bg: 'rgba(45,212,160,.12)', color: '#3edcb1', border: 'rgba(45,212,160,.35)' },
    { bg: 'rgba(245,200,66,.12)', color: '#f5c842', border: 'rgba(245,200,66,.35)' },
    { bg: 'rgba(255,138,61,.12)', color: '#ff8a3d', border: 'rgba(255,138,61,.35)' },
    { bg: 'rgba(255,107,127,.12)', color: '#ff8aa1', border: 'rgba(255,107,127,.35)' },
    { bg: 'rgba(184,255,87,.12)', color: '#b8ff57', border: 'rgba(184,255,87,.35)' },
    { bg: 'rgba(122,128,128,.15)', color: '#a8b0b0', border: 'rgba(122,128,128,.35)' },
  ];

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  window.fvTagColor = function (tag) {
    if (!tag) return FALLBACK[7];
    const t = String(tag).toLowerCase();
    if (SEMANTIC[t]) return SEMANTIC[t];
    return FALLBACK[hashStr(t) % FALLBACK.length];
  };

  // Helper pratique : retourne le style inline pour un chip
  window.fvTagStyle = function (tag) {
    const c = window.fvTagColor(tag);
    return `background:${c.bg};color:${c.color};border:1px solid ${c.border}`;
  };
})();

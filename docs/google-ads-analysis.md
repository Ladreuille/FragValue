# Google Ads sur FragValue : analyse et recommandation

**Date** : 11 juin 2026
**Contexte** : question Quentin "est-ce qu'on peut mettre du Google Ads sur le site ?"

Deux interprétations possibles, deux réponses très différentes.

## Option A : AdSense (afficher des pubs sur le site, toucher des revenus)

**Verdict : techniquement possible, fortement déconseillé.**

### Blocages techniques
- Depuis janvier 2024, Google exige une **CMP certifiée TCF v2.2** pour servir
  des annonces personnalisées en EEA/UK. Notre banner cookie maison
  (analytics.js) n'est pas certifié TCF. Il faudrait migrer vers Cookiebot,
  Didomi ou Google Privacy &amp; Messaging : refonte du consent flow complet.
- Fichier ads.txt à la racine + validation du site par AdSense (process de
  review, le site doit avoir du contenu "substantiel" : le blog aide, les
  pages produit early access peuvent freiner).

### Blocage business (le vrai problème)
- CPM display gaming FR : entre 0,50 et 2 EUR. Au trafic actuel du site,
  cela représente quelques euros par mois, au mieux.
- Un seul abonné Pro converti (9 EUR/mois) rapporte plus que des milliers
  d'impressions AdSense.
- Des bannières tierces sur un SaaS premium détruisent exactement le
  positionnement "irréprochable" que la refonte V3 vient de construire,
  et cannibalisent la conversion vers Pro/Elite.

## Option B : tag Google Ads (acheter du trafic, tracker les conversions)

**Verdict : faisable immédiatement, recommandé si budget acquisition.**

### Ce qui est déjà en place (rien à refaire)
- gtag.js chargé sur toutes les pages (G-H6PLDKSCJR).
- **Consent Mode v2 complet** : défaut denied en EEA/CH/GB, et le banner
  accorde les 4 signaux requis (ad_storage, ad_user_data,
  ad_personalization, analytics_storage) sur Accepter. C'est l'exigence
  Google Ads EEA depuis mars 2024 : on est déjà conformes.
- Capture UTM pour attribution signup (analytics.js).
- Events GA4 exploitables comme conversions : coach_cta_click,
  section_view, scroll_depth, engagement_heartbeat (instrumentation A/B
  v3_coach), consent_accepted.

### Ce qu'il reste à faire (~1h de travail + setup compte)
1. Créer le compte Google Ads (SIREN dispo pour la facturation).
2. Lier Google Ads et GA4, importer les conversions GA4 pertinentes :
   signup (à instrumenter proprement côté login.html), trial Pro démarré,
   achat Stripe (via page de succès checkout).
3. Optionnel : tag de conversion dédié AW-XXXXXXX dans le head (1 ligne
   gtag config en plus).
4. Définir les conversions primaires : signup et trial_start (pas le
   simple clic CTA, trop haut de funnel pour piloter les enchères).

### Angle campagnes (quand on y sera)
- Search FR/EU : "analyse demo cs2", "stats faceit", "coach cs2",
  "améliorer cs2" ; cible coachs : "outil coach cs2", "planning équipe esport".
- Le mode Coach (B2B, 5 EUR/seat) supporte un CAC bien plus élevé que le
  B2C 9 EUR/mois : prioriser les mots-clés coach dès que le coach mode
  sort de l'early access.
- Budget test raisonnable : 10 à 20 EUR/jour pendant 2 semaines, on coupe
  ou on scale selon le coût par signup.

## Recommandation

Ne pas vendre l'attention de tes visiteurs (Option A), l'acheter pour les
faire entrer dans le funnel (Option B). Le site est déjà prêt côté consent
et mesure : la décision est purement budget marketing, pas technique.

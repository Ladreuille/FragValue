# Reddit /r/GlobalOffensive Post (J-Day ou J+1)

**Subreddit** : r/GlobalOffensive (3.6M members, peak audience 18-22h CET weekdays)
**Règles clés** : pas de self-promo direct sauf si "Project / Tool" approuvé par mods.
**Stratégie** : viser flair "Discussion" ou "Tips & Guides", apporter de la valeur AVANT de mentionner FragValue.

⚠️ **Lire les règles du sub d'abord** : https://www.reddit.com/r/GlobalOffensive/about/rules
Le sub est strict, un mauvais post = ban permanent. Si t'es pas sûr, DM les mods.

---

## Option 1 : Post analytique (recommandé)

**Title** : `I analyzed 200 FACEIT matches with AI to find what separates Lvl 8 from Lvl 10 — here's the data`

**Body** :

```
Solo dev here. Spent the last 3 months building an AI coach that analyzes
CS2 demos round-by-round (yes, another analytics tool — bear with me, the
data is interesting).

To validate it, I ran 200 anonymized FACEIT matches across Lvl 6-10 through
the same Claude (Anthropic) pipeline and looked for the patterns that
separate the brackets.

**TL;DR what separates Lvl 8 from Lvl 10 :**

1. **Opening duels win rate** : Lvl 10 wins 54% of opening duels vs Lvl 8 at 47%.
   The 7pt gap compounds because lost openings = 4v5 = round usually lost.

2. **Trade kills as trader** : Lvl 10 averages 2.3 trade kills per map, Lvl 8 at 1.4.
   Lvl 10 plays MUCH closer to teammates by default.

3. **Utility timing** : Lvl 10 throws 73% of utility within the first 25s of round.
   Lvl 8 dumps a lot of util in the last 15s (panic util).

4. **Economy discipline** : Lvl 10 forces 0.8 times per map. Lvl 8 forces 1.6.
   Force-buying eco rounds bleeds economy across 3-4 rounds.

5. **Spray vs tap consistency** : at long range (>15m), Lvl 10 taps 68% of duels.
   Lvl 8 sprays 54% at long range. Wider crosshair placement = worse first shot.

What I'm NOT seeing (might surprise you) :
- Reaction time barely differs (Lvl 8 = 245ms, Lvl 10 = 232ms)
- Crosshair placement is similar in 1v1 sims
- ADR isn't a strong differentiator (Lvl 10 = 76, Lvl 8 = 71)

The biggest gap is **decision quality under pressure**, not mechanical skill.

Happy to share the methodology + the raw data if anyone's curious.

If you want the AI coach tool I built to analyze your own demos
(free tier = 3 analyses/month) :
https://fragvalue.com

It's a solo project, no investors, no hype. Built it because I was tired
of Leetify telling me my ADR was 75 without explaining why I lost R14.

Roast me in comments — I want feedback brut.
```

**Pourquoi ça marche** :
- 5 insights actionnables AVANT de mentionner le produit
- Le sub adore les data-driven posts
- Disclaimer honest "solo dev, no hype" = construit trust
- Demande feedback explicite = engage les commentateurs

---

## Option 2 : Post tactical analysis

**Title** : `I built an AI tool that explains the EXACT moment a round was lost. Here are 3 examples from pro demos.`

**Body** :

```
Built a Coach IA that reads CS2 demos round-by-round and explains
tactical decisions in plain English (with tick references).

Ran it on 3 pro rounds where the analysis surprised me. Sharing because
the "obvious mistake" wasn't what I expected.

---

**Example 1 : Vitality vs Spirit Mirage R14 (2025 Major)**

What I thought : "ZywOo missed the AWP on long."

What the AI showed : the round was decided at tick 47000 when ropz
threw a smoke on connector 1.2s too late. ZywOo's AWP was always
going to get pre-fired because Spirit had pre-walked the angle.

The mistake was the smoke timing, not the duel.

---

**Example 2 : G2 vs FaZe Inferno R8 (IEM Cologne)**

What I thought : "FaZe lost a 4v3, T side eco."

What the AI showed : with 4 players alive vs 3, FaZe never grouped
on B. They stayed split A-mid-B doors. By the time they decided to
push B, the rotations had completed. The 4v3 was wasted by indecision.

The mistake was the comm gap, not the duels.

---

**Example 3 : My own ESEA Open match (yes, bringing it back to me)**

What I thought : "I clutched 1v2 because of aim."

What the AI showed : I won because the 2nd player had a flash
in hand at the wrong moment. If they'd defaulted to AK only, I lose.

The win was opponent error, not my mechanic.

---

This is the type of context I wish my analysis tools gave me.

If you want to try it on your own demos (free 3/month, no CB) :
https://fragvalue.com

Built solo over 3 months. Use Claude (Anthropic) under the hood.
Constructive criticism welcome — I'm learning the analytics space.
```

**Pourquoi ça marche** :
- Pro demo names = credibility chez le sub
- "What I thought vs what the AI showed" = format viral
- Self-deprecating ("ESEA Open") = humble, pas d'over-selling

---

## Règles d'engagement après le post

1. **Réponds à TOUS les commentaires <12h** (mods et users voient l'engagement)
2. **Sois honnête sur les limites** : si quelqu'un dit "j'ai testé, l'AI s'est trompée sur X", réponds "tu as raison, ça arrive sur Y et on bosse dessus". Mensonge = ban communauté.
3. **Évite de re-poster ton lien dans tes propres réponses** sauf si demandé explicitement
4. **Si downvoté à <50% : DELETE et apprend**. Un post bouille à -100 plante ton karma futur sur le sub
5. **Tag avec [Discussion] ou [Tips] flair**, jamais [Self-Promotion] (mort instantanée)

---

## Backup : si /r/GlobalOffensive bloque

Subs alternatifs ordre de priorité :
1. **r/cs2** (taille moyenne mais public + receptif aux outils)
2. **r/FACEITcom** (audience directement ciblée)
3. **r/csgo** (legacy but still active)
4. **r/LearnCSGO** (audience qui CHERCHE des outils de progression — pourrait être le meilleur ROI)

Adapt le ton selon le sub — r/LearnCSGO est plus chill, r/csgo plus aggressif sur le marketing.

# ArenaVisualsTODO.md — RENDU & IMMERSION DE NIMBO ARENA

> Ouvert le 2026-09-08. Branche dédiée : `arena-visuals` (partie de `master` @ `d85cf3b`).
> Déclencheur : le jeu est *fun* (validé à l'alpha-test, D85) mais il **ne donne pas envie**.
> Référence visuelle : captures de slither.io fournies par le user le 2026-09-08.
> Périmètre : `arena/client/` uniquement. **Aucune ligne de serveur, aucune ligne on-chain.**

---

## ÉTAT AU 2026-09-08 — À LIRE EN PREMIER

**AV.0, AV.1 et AV.1b sont LIVRÉS** (commit `a54b438`, poussé) : fond
hexagonal, compteur de FPS, overlays de netcode éteints pour les joueurs.

**AV.2 est ÉCRIT, typecheck vert, EN ATTENTE DE VALIDATION VISUELLE.**
Les trois chiffres de référence FPS d'AV.0 restent à relever — et AV.2 est
précisément le premier ticket qui les fait bouger (chaque pastille coûte
désormais 2 sprites au lieu d'1).

Le socle technique est en place et il est bon :

- **PixiJS 8.19.0 (WebGL)** est déjà la dépendance de rendu — vérifié dans
  `arena/client/package.json` et `arena/node_modules/pixi.js`.
- `render.ts` (332 lignes) respecte déjà la bonne discipline : **une seule
  texture partagée** (`circleTexture`) instanciée en sprites, donc un seul
  appel de dessin pour tout le corps d'un serpent. Le commentaire de
  `SnakeView` documente explicitement ce raisonnement. **Tout ce qui suit
  doit préserver cette propriété.**
- La séparation simulation / rendu est nette : `session.ts` calcule toutes
  les positions, `render.ts` ne fait que dessiner.

**>>> PROCHAIN TICKET : AV.3 (texture de segment ombrée) <<<**

---

## DOCTRINE — les trois règles qui priment sur toute considération esthétique

### R1. Le rendu ne ment JAMAIS sur la géométrie de jeu

A4.13 a coûté des mois : le client passait `SNAKE_TURN_SPEED` là où le
serveur passait `dims.turnSpeed`, l'écart était nul à score 0 et de 27 % à
score 2000. Invisible, et pourtant décisif dans un jeu à argent réel.

Conséquence pour CE chantier : on modifie **les textures, les teintes, les
calques, l'opacité**. On ne touche **jamais** :

- `SNAKE_RADIUS`, ni le `scale` dérivé de `dims.radius` ;
- les positions de segments fournies par `session.ts` ;
- le nombre de segments dessinés ;
- `FOOD_RADIUS`, `EXTRACT_RADIUS`, `AOI_RADIUS`.

Corollaire moins évident : **un halo ne doit jamais pouvoir être confondu
avec un corps.** Si le joueur croit que la hitbox est plus grosse qu'elle
ne l'est, c'est un bug de gameplay déguisé en effet spécial. Les halos
restent nettement plus diffus et plus larges que l'objet qu'ils éclairent.

### R2. Le budget de frames est le budget mainnet (D85)

D85 : « pour tout ce qui touche au gameplay et à la fluidité, on ne
raisonne plus MVP puis optim plus tard ». Un effet joli qui fait tomber le
framerate est un **mauvais échange**, pas un compromis acceptable.

Chaque ticket se valide avec un chiffre, pas avec une impression. Voir AV.0.

### R3. Zéro dépendance nouvelle tant que ce n'est pas prouvé nécessaire

Ajouter un paquet à `arena/` déclenche le rituel du lockfile Alpine
(`arena/client/Dockerfile` fait `npm ci` sur `node:20-alpine`) — piège
`@emnapi` déjà payé trois fois. Les tickets AV.1 → AV.8 sont conçus pour
n'exiger **aucune dépendance**. Seul AV.10 en demande une, et il est
conditionné à une mesure.

---

## Ce que les captures de référence contiennent réellement

Décomposition, pour que chaque ticket ait une cible nommée :

| # | Effet observé | Ticket |
|---|---|---|
| 1 | Trame hexagonale régulière et biseautée, qui défile | AV.1 |
| 2 | Halo diffus coloré sous chaque pastille, qui « éclaire » le fond | AV.2 |
| 3 | Saturation vers le blanc quand les halos se superposent | AV.2 |
| 4 | Corps ombré en tube (clair au centre, sombre aux bords) | AV.3 |
| 5 | Yeux blancs à pupille sombre, orientés | AV.4 |
| 6 | Peaux à bandes (rouge/blanc/bleu, orange/crème…) | AV.5 |
| 7 | Assombrissement des bords de l'écran | AV.6 |
| 8 | Serpent en boost qui rayonne et lave le fond | AV.7 |
| 9 | Mort = nappe d'orbes incandescents | AV.8 |
| 10 | Liseré sombre autour du corps | AV.5 (option) |

**Le point technique qui change tout :** slither.io n'utilise **aucun
post-traitement**. C'est du Canvas 2D. Les halos sont des **sprites de
dégradé radial en blending additif**. La lumière n'est pas calculée, elle
est dessinée. On peut donc reproduire 85 % du rendu sans un seul shader.

---

## API Pixi 8.19 — vérifiées dans les typings installés le 2026-09-08

Ne rien coder de mémoire au-delà de cette liste ; re-vérifier le reste.

| Besoin | Statut |
|---|---|
| `blendMode = 'add'` | ✅ chaîne littérale en v8 (`rendering/.../state/const.d.ts`) |
| `TilingSprite` | ✅ `scene/sprite-tiling/` |
| `FillGradient` avec `type: 'radial'` | ✅ `scene/graphics/shared/fill/FillGradient.d.ts` |
| `ParticleContainer` + `Particle` | ✅ `scene/particle-container/` (API refaite en v8) |
| `renderer.generateTexture()` | ✅ déjà utilisé dans `render.ts:create()` |
| Bloom / glow intégré | ❌ **absent** — filtres natifs = blur, color-matrix, noise, displacement, alpha |

---

# TICKETS

## AV.0 — Instrumenter avant de toucher à quoi que ce soit

**Pourquoi.** R2 exige des chiffres. Sans mesure de départ, « ça rame un
peu » est une impression et on ne saura jamais quel effet a coûté quoi.

**À faire.**
- Afficher `app.ticker.FPS` (lissé sur ~30 frames) dans le HUD de debug
  existant, ainsi que le nombre de sprites du calque nourriture.
- Noter la valeur de référence sur trois configurations : la machine du
  user, une machine faible, et un mobile si le jeu y est jouable.
- Consigner ces trois chiffres **ici même**, dans ce fichier.

**Validation.** Les trois chiffres sont écrits dans ce fichier.

**Risque.** Nul.

---

## AV.1 — Fond hexagonal (le plus gros écart visuel)

**Pourquoi.** Aujourd'hui le décor est un aplat `#0b1020` + 900 points
aléatoires dessinés une fois (`render.ts`, dans `create()`). Un motif
**aléatoire** ne donne aucune sensation de vitesse : l'œil a besoin d'une
**régularité** pour mesurer un déplacement. C'est la raison pour laquelle
slither.io utilise une trame hexagonale, et c'est ce qui manque le plus.

**Technique.**
1. Générer **une fois** une texture de tuile via `renderer.generateTexture()`
   sur un `Graphics` — même approche que `circleTexture`, donc zéro asset,
   zéro requête réseau.
2. L'afficher dans un `TilingSprite` en espace monde, 2800 × 2800
   (`WORLD_RADIUS = 1400`), inséré **sous** tous les autres calques.
3. Biseau : chaque hexagone reçoit une arête haute claire et une arête
   basse sombre — c'est ce qui donne le relief embossé des captures.

**Le piège à ne pas rater.** La **période du réseau** doit être exacte ou
une couture défilera à l'écran. Pour des hexagones à sommet plat de rayon
`R` : le motif se répète sur un rectangle `3R × √3·R` contenant deux
centres, `(0,0)` et `(1.5R, √3R/2)`. À valider **à l'œil, en mouvement** —
un pixel d'erreur se voit immédiatement.

**Fichiers.** `arena/client/src/render.ts` (méthode `create()`).

**Validation.** Se déplacer en diagonale sur toute la largeur de la map
sans voir apparaître la moindre ligne de raccord.

**Coût GPU.** Un seul quad, le shader de répétition fait tout. Gratuit.

**Risque.** Nul (purement décoratif, aucune interaction avec la sim).

---

## AV.2 — Halos additifs sur la nourriture (« effet de halo »)

**Pourquoi.** C'est la signature visuelle de slither.io. Sur les captures,
chaque pastille projette un halo 6 à 10× plus large qu'elle, à très faible
opacité, et **dix halos superposés saturent vers le blanc** — signature du
blending additif, qu'un blending normal ne peut pas produire (il donnerait
un aplat terne).

**Technique.**
1. Une **texture unique** de tache ronde floue : disque blanc dont l'alpha
   va de 1 au centre à 0 au bord.
   - Voie principale : `Graphics` + `FillGradient({ type: 'radial' })` puis
     `generateTexture()`.
   - **Repli éprouvé si le dégradé Pixi fait des siennes** : un `<canvas>`
     avec `ctx.createRadialGradient()` puis `Texture.from(canvas)`. Zéro
     dépendance, comportement parfaitement prévisible.
2. Un `Container` `glowLayer` inséré **entre le fond (AV.1) et le calque
   nourriture**.
3. Un sprite par pastille : `blendMode = 'add'`, `tint` = couleur de la
   pastille, `scale` ≈ 8× le rayon, `alpha` ≈ 0.2 (à régler à l'œil).
4. Cycle de vie **strictement couplé** à `foodSprites` : `addFood()` crée
   les deux, `removeFood()` détruit les deux. Une fuite ici laisse des
   halos orphelins qui éclairent le vide.

**Pourquoi ça ne coûte rien.** Tous les halos partagent **une seule
texture** → Pixi les regroupe en un appel de dessin. Trois cents halos
coûtent autant qu'un seul. C'est exactement le raisonnement déjà écrit
dans le commentaire de `SnakeView`.

**Fichiers.** `render.ts` : `create()`, `addFood()`, `removeFood()`, `clear()`.

**Validation.**
- Un amas d'orbes de cadavre sature visiblement vers le blanc (capture 4).
- FPS inchangé vs AV.0 avec le maximum de pastilles à l'écran.
- Après une mort et un respawn, `foodSprites.size === glowSprites.size`.

**Risque.** Faible. Surveiller R1 : le halo doit rester manifestement plus
diffus que la pastille, jamais lisible comme une hitbox.

---

## AV.3 — Texture de segment ombrée (meilleur rapport gain/effort)

**Pourquoi.** `circleTexture` est un disque **uni**, d'où l'aspect
« chapelet de gommettes ». Sur les captures, le corps lit comme un **tube** :
bande centrale claire, bords sombres.

**Technique.** Remplacer le disque uni par un disque **pré-ombré en niveaux
de gris** (dégradé radial légèrement décentré + rebord sombre). La teinte
Pixi étant une **multiplication**, `tint` continue de fonctionner
exactement comme aujourd'hui.

**La propriété à préserver.** Toujours **une seule texture** → le batching
et le coût de rendu sont rigoureusement inchangés. C'est un remplacement de
texture, pas un changement d'architecture.

⚠️ **La texture est générée à `SNAKE_RADIUS` et mise à l'échelle par
`scale = radius / SNAKE_RADIUS`.** Générer la texture ombrée à une
résolution plus élevée (ex. ×4) pour que les gros serpents ne soient pas
flous — mais **sans toucher au calcul de `scale`** (R1).

**Fichiers.** `render.ts` : `create()`.

**Validation.** Un serpent de score élevé ne montre pas de pixellisation ;
le corps lit comme un volume et non comme des disques empilés.

**Risque.** Faible.

---

## AV.4 — Les yeux (plus gros gain de personnalité de toute la liste)

**Pourquoi.** Sur les quatre captures, la tête porte deux yeux blancs à
pupille sombre, décalés perpendiculairement à la direction. C'est ce qui
transforme un cercle en **créature**. Chez toi, la tête est un disque
teinté — c'est probablement la première chose qu'un testeur remarquera.

**Technique.** Quatre sprites enfants du conteneur de tête (deux sclères,
deux pupilles), positionnés avec la perpendiculaire au cap. La pupille se
décale légèrement dans la direction du regard.

**Où trouver le cap.** `session.ts` connaît la direction ; `drawSnake()` ne
la reçoit pas aujourd'hui. Deux options :
- la déduire du vecteur `tête → premier segment` **côté renderer** (aucun
  changement de signature, aucun risque de désynchronisation) — **préféré** ;
- ou l'ajouter à la signature de `drawSnake()`.

**Fichiers.** `render.ts` : `drawSnake()`.

**Validation.** Les yeux restent cohérents dans un virage serré et pendant
un boost ; aucun tremblement à basse vitesse.

**Risque.** Faible. Ne consomme aucune donnée réseau supplémentaire.

---

## AV.5 — Peaux à bandes + liseré (ouvre la porte aux skins NFT)

**Pourquoi.** Les peaux rouge/blanc/bleu et orange/crème des captures 2 et
3 **ne sont pas des textures** : c'est la teinte qui change selon l'index
du segment. Chez nous, la boucle qui positionne les segments existe déjà.

**Technique.**
```
s.tint = palette[Math.floor(i / bandWidth) % palette.length];
```

**Coût : nul.** Et l'implication produit est importante : une peau devient
**une palette + une largeur de bande**, soit quelques octets — pas un asset
à stocker ni à servir. C'est exactement le format qu'il faut pour la
marketplace de skins cosmétiques du business model, et ça garantit
structurellement le « jamais de pay-to-win » (une palette ne peut pas
porter d'avantage de jeu).

**Option — liseré sombre** (le serpent blanc de la capture 4). Un second
sprite légèrement plus grand et sombre derrière chaque segment. ⚠️ Cela
**double le nombre de sprites** : à réserver au joueur local, ou à mesurer
avant de généraliser. **Ne pas livrer sans le chiffre AV.0.**

**Fichiers.** `render.ts` : `drawSnake()` ; palettes dans le même fichier.

**Validation.** FPS inchangé. Les bandes ne créent pas d'illusion de
segmentation de la hitbox (R1).

**Risque.** Faible pour les bandes, **moyen pour le liseré** (perf).

---

## AV.6 — Vignette et ambiance générale

**Pourquoi.** Les captures s'assombrissent nettement vers les bords, ce qui
concentre l'attention au centre — là où se trouve la tête du joueur.

**Technique.** Un sprite plein écran en **espace écran** (pas dans `world`),
dégradé radial noir, alpha faible, ajouté au `stage` **sous** le minimap et
le HUD. Redimensionné sur l'événement de resize.

**Fichiers.** `render.ts` : `create()` + gestion du resize.

**Validation.** La vignette ne bouge pas avec la caméra et ne masque ni le
minimap ni le HUD.

**Risque.** Nul.

---

## AV.7 — Glow de boost

**Pourquoi.** Capture 2 : le grand serpent en boost **rayonne** et lave le
fond. Aujourd'hui, le boost ne change que la couleur de la tête en blanc
(`session.ts` : `const drawn = boosting ? { body: colors.body, head: "#ffffff" } : colors`).
C'est le moment le plus intense du jeu et il ne se voit presque pas.

**Technique.** Réutiliser la texture de halo d'AV.2, en sprites additifs le
long du corps, plus grands et plus opaques pendant le boost. Ne les créer
que pour les serpents effectivement en boost.

**Changement de signature nécessaire.** `drawSnake()` ne reçoit pas l'état
de boost — `session.ts` le calcule (`boosting`) mais ne le transmet que
déguisé en couleur de tête. Il faut le passer explicitement.
**C'est l'occasion de remplacer le paramètre `colors` par un objet de style
unique** (`{ body, head, boosting, offline }`) plutôt que d'ajouter un
huitième argument positionnel à une signature qui en compte déjà huit.

**Fichiers.** `render.ts` : `drawSnake()` ; `session.ts` : le site d'appel
(~ligne 741). **Uniquement le passage de l'information — aucune logique de
simulation touchée** (R1).

**Validation.** FPS stable avec plusieurs serpents en boost simultané dans
l'AoI.

**Risque.** Moyen (nombre de sprites variable). Borner le nombre de halos
par serpent, indépendamment de la longueur du corps.

---

## AV.8 — La mort doit se voir

**Pourquoi.** La mort est l'événement le plus coûteux du jeu : le joueur
perd sa mise. Capture 4 : une nappe d'orbes incandescents. Chez nous, les
orbes existent déjà (`ORB_TINT`, aire proportionnelle à la valeur) mais
apparaissent sans aucune emphase.

**Technique.**
- Halo additif sur les orbes (vient gratuitement avec AV.2, l'aire étant
  déjà proportionnelle à la valeur).
- Un « pop » d'échelle à l'apparition (~200 ms).
- Optionnel : onde de choc au point de mort — un anneau qui s'étend et
  s'efface, en `Graphics`, sans dépendance.

**Point de vigilance produit.** Le 70/30 (D71 amendé) veut que 30 % de la
valeur soit **recyclée map-wide**, pas déposée sur le cadavre. L'effet
visuel ne doit pas laisser croire que 100 % du butin est là, sur place —
sinon l'écran ment sur l'économie, ce qui est précisément l'invariant que
D71 protège (« pellet visible = argent réel »).

**Fichiers.** `render.ts` : `addFood()` + une petite animation.

**Validation.** Une mort à forte valeur est lisible d'un coup d'œil ; le
volume d'orbes reste cohérent avec la valeur réellement au sol.

**Risque.** Faible.

---

## AV.9 — HUD, minimap et menu — À CADRER AVANT DE CODER

**Statut : EN ATTENTE D'ARBITRAGE DU USER.**

Le HUD est aujourd'hui **du DOM par-dessus le canvas** (`main.ts` :
`document.getElementById("status")`), plus un minimap en `Graphics` dessiné
en espace écran. Le menu est `arena/client/src/menu.ts` (165 lignes).

Trois périmètres possibles, non tranchés :
1. l'écran de **menu** du client de jeu (choix de mise, entrée en partie) ;
2. le **HUD en jeu** (valeur portée, timer d'extraction, avertissements) ;
3. une page du **portail Next** dans `app/`.

Pour 1 et 2, c'est du DOM/CSS classique : on peut réutiliser directement la
charte du portail (F3.x). Pour le canvas, il n'existe pas de « librairie de
composants » — c'est Pixi et des textures.

**À trancher avant d'ouvrir un ticket.**

---

## AV.10 — Bloom en post-traitement — CONDITIONNEL, NE PAS COMMENCER

**Statut : bloqué par une mesure et une vérification.**

**Ce que ça apporterait.** Un bloom réagit à ce qui est *réellement*
lumineux à l'écran, donc plus juste que des halos dessinés — notamment le
« soleil blanc » de la capture 2.

**Les trois réserves, par ordre d'importance.**
1. **Coût.** Un filtre sur un conteneur force un rendu dans une texture
   intermédiaire, puis seuil + flou + composition. C'est la différence
   entre 60 et 30 fps sur une machine faible. **R2 dit que c'est un mauvais
   échange.** À n'appliquer qu'à un calque dédié, **jamais au stage entier**
   (sinon le HUD est bavé).
2. **Dépendance.** `pixi-filters` n'est pas installé. **La compatibilité
   avec Pixi 8.19 est à VÉRIFIER sur le dépôt officiel — ne pas la supposer
   depuis une connaissance datée.**
3. **Lockfile.** Toute nouvelle dépendance de `arena/` impose de régénérer
   le lock **dans l'image cible** (piège `@emnapi` payé 3 fois) :
   ```
   docker run --rm --platform linux/amd64 -v "$PWD/arena":/app -w /app \
     node:20-alpine npm install --package-lock-only
   ```
   Indicateur de non-régression correct (leçon FrontTODO F2.4) : « toute
   dépendance dure déclarée est-elle résolvable dans le lockfile ? » —
   **pas** un comptage d'entrées.

**Condition d'ouverture.** AV.1 → AV.8 livrés ET mesurés, et un manque
esthétique **précis et nommé** subsiste. Si les halos additifs suffisent —
et ils suffisent chez slither.io — ce ticket est **abandonné**, pas reporté.

---

# ORDRE D'EXÉCUTION

| Ordre | Ticket | Effet ressenti | Effort | Dépendance nouvelle |
|---|---|---|---|---|
| 1 | AV.0 instrumentation | — | très faible | non |
| 2 | AV.1 fond hexagonal | énorme | faible | non |
| 3 | AV.2 halos additifs | énorme | faible | non |
| 4 | AV.3 segment ombré | fort | faible | non |
| 5 | AV.4 yeux | fort | faible | non |
| 6 | AV.5 peaux à bandes | moyen | très faible | non |
| 7 | AV.6 vignette | moyen | faible | non |
| 8 | AV.7 glow de boost | fort | moyen | non |
| 9 | AV.8 emphase de la mort | moyen | faible | non |
| — | AV.9 HUD/menu | ? | ? | **à cadrer** |
| — | AV.10 bloom | raffinement | moyen | **oui — conditionnel** |

AV.1 → AV.3 sont **indépendants les uns des autres** et peuvent être
commités séparément. AV.7 et AV.8 dépendent de la texture de halo d'AV.2.

---

# DÉPLOIEMENT

Ce chantier ne touche que `arena/client/`. Donc :

```bash
ssh root@167.233.250.97
cd /root/nimbo
git pull
docker compose --profile https up -d --build client
```

**Ne nommer que `client`.** Recréer `server` déconnecte tous les joueurs
actifs, et déconnexion = mort instantanée = mise perdue (règle
anti-rage-quit, amendée 2026-08-06). Un déploiement du seul client est
**sans danger à n'importe quelle heure** — c'est un avantage qu'on perd dès
qu'on touche au serveur.

Rappel : `VITE_SERVER_URL` est gravé au build → `--build` obligatoire,
`restart` ne suffirait pas (DEPLOY.md §4bis).

---

# BACKLOG — ne PAS commencer sans accord explicite

- **`ParticleContainer` v8** pour la nourriture si le profilage le réclame.
  L'API a été refaite en v8 et contraint fortement ce qu'on peut faire par
  particule. **Uniquement sur preuve chiffrée**, jamais par précaution.
- Traînées de boost persistantes (coûteux, et risque R1 : une traînée ne
  doit pas ressembler à un corps).
- Thème alternatif (les captures montrent une variante verte).
- Skins comme actifs cosmétiques on-chain — dépend d'AV.5, mais c'est un
  chantier produit, pas un chantier de rendu.
- Effets météo / événements d'arène.

---

# JOURNAL

*(à remplir au fil des tickets : date, ticket, commit, mesure FPS avant/après,
et surtout ce qui a coûté du temps et ne doit pas être redécouvert)*

| Date | Ticket | Commit | FPS avant → après | Leçon |
|---|---|---|---|---|
| 2026-09-08 | AV.0 | `a54b438` | — | `ticker.FPS` de Pixi ne rapporte QUE la dernière frame (`1000/elapsedMS`) : le lire une fois par seconde échantillonne une frame arbitraire et affiche du bruit. On compte les frames sur une fenêtre de 500 ms. |
| 2026-09-08 | AV.1 | `a54b438` | — | Voir la note ci-dessous sur la période de tuile — c'est le seul vrai piège du ticket. |
| 2026-09-08 | AV.3 | *(non commité)* | à relever | Texture de segment ombrée. **`resolution` est la clé du ticket** : la source porte 4× les pixels tout en DÉCLARANT la même taille logique (24×24), donc `scale = radius / SNAKE_RADIUS` reste vrai partout et aucun site d'appel ne change (R1 respecté sans effort). Suréchantillonner était nécessaire : le rayon monte à ×3 à score 10 000 et ×5,5 à 50 000 — un aplat survivait à ça, un dégradé non. **Dégradé radial à DEUX cercles, cœur décalé en haut-à-gauche** : c'est le décalage qui fait le volume, un dégradé centré lit comme un anneau plat. Niveaux en **gris** parce que `tint` MULTIPLIE — 1.0 laisse la couleur intacte, rien ne peut décaler une teinte. ⚠ Effet de bord attendu : niveau moyen ~0,75 donc serpents et pastilles ~25 % plus sombres qu'avant. |
| 2026-09-08 | AV.2b | *(non commité)* | à relever | Clignotement des halos + orbes de cadavre 30 % plus lumineux (demande user). **Phase ET vitesse randomisées par pastille** : sur une horloge partagée sans décalage, tous les halos respirent à l'unisson — ça se lit comme un bug de stroboscope, pas comme un champ vivant. Désynchronisé, le même effet devient du scintillement d'ambiance. **Seul le halo respire, jamais la pastille** (R1 : la vérité lisible du jeu ne s'anime pas pour décorer). Horloge murale (`performance.now()`) et non accumulateur : rien ne dérive, et un onglet en arrière-plan reprend à la bonne phase au lieu de rejouer son absence. Le rapport 30 % tient au creux comme au sommet du cycle (les deux alphas oscillent proportionnellement). |
| 2026-09-08 | AV.2 | *(non commité)* | à relever | Halo = sprite **frère** de la pastille dans un calque dédié, jamais son enfant : dans `foodLayer` la séquence deviendrait pastille/halo/pastille/halo, et le batcher ne fusionne que des sprites **consécutifs** partageant texture ET mode de fusion. Un calque chacun = 2 appels de dessin quel que soit le nombre de pastilles. — Texture fabriquée sur un **canvas 2D** (`CanvasSource`) et non avec `FillGradient` : contrôle exact de l'alpha à chaque palier. La **courbe** est le sujet : une rampe linéaire 1→0 lit comme un cône plat, pas comme de la lumière ; il faut une décroissance de type inverse-carré (cœur vif, chute rapide, longue jupe faible). |
| 2026-09-08 | AV.1b | `a54b438` | — | Overlays de debug (fantôme serveur vert + bulle AoI) **éteints pour les joueurs** (décision user : le fantôme vert donne une impression de latence). **Mis derrière `?debug` dans l'URL, PAS supprimés** — c'est l'instrument de diagnostic d'A4.14. Retirer la mesure pour masquer le symptôme transforme un bug connu en bug inconnu. Param d'URL et non drapeau de build : activable sur le site EN LIGNE sans rebuild. Aucun risque d'avantage (A1.8) : n'affiche que notre propre position serveur et notre propre rayon d'AoI, jamais un adversaire. |

## AV.3b — LA COMPARAISON MESURÉE (2026-09-08) — à ne pas refaire

Le user a trouvé notre rendu « pas propre » sans savoir pourquoi, et a
supposé une histoire de couleurs pâles. Plutôt que de trancher à l'œil, les
deux captures (la nôtre + slither) ont été **échantillonnées pixel par
pixel** (`sips -s format bmp` puis parsing BMP en Python pur — la machine
n'a ni PIL ni ImageMagick, cf. [[front-redesign]]).

| | Nous | slither.io |
|---|---|---|
| Saturation du corps (médiane) | **0,79** | **0,50** |
| Saturation, étendue | 0,38 → 0,80 | **0,49 → 0,51** |
| Valeur du corps (médiane) | 0,52 | 0,63 |
| Valeur, pic | 0,74 | 0,87 |
| Saturation du fond | **0,39** | **0,21** |
| Valeur du fond | 0,200 | 0,165 |
| Contraste corps/fond | ×2,6 | ×3,8 |
| Période du motif hexagonal | 288 px | 183 px |

**Les trois enseignements, par ordre d'importance :**

1. **Le « chapelet de perles » ne venait PAS de la silhouette.** Calculé :
   avec `r = 12` et `SNAKE_SPACING = 10`, la bosse du contour vaut
   `12 − √(144−25) = 1,09 px` sur 24 de large, soit **4,5 %** — invisible.
   Le coupable était le **dégradé RADIAL d'AV.3** (bord à 0,46) : chaque
   disque peignait son liseré sombre par-dessus le cœur clair du précédent,
   soit une arche sombre tous les 10 px. **Corrigé en changeant la NATURE
   du dégradé, pas son intensité** : linéaire, perpendiculaire à la marche
   (rotation du sprite sur le cap local). Le long du corps la valeur devient
   constante → aucun arc interne possible ; en travers le contraste reste
   fort → un vrai cylindre. Signature confirmée par la mesure : chez slither
   H et S sont **verrouillés** pendant que V double.
2. **Notre fond était BLEU** (S = 0,39), le leur est une ardoise neutre
   (S = 0,21). Un bleu saturé sous un serpent bleu saturé s'empâte. Passer
   au neutre fait monter le contraste corps/fond de ×2,6 à ×3,8 **sans rien
   éclaircir**. Différence invisible tant qu'on ne la mesure pas.
3. **La dispersion de saturation trahit un défaut de forme.** `tint` étant
   une multiplication, S devrait être CONSTANT sur le corps. Nos 0,38 → 0,80
   étaient des pixels de bord : trop de périmètre, donc trop de contour —
   confirmation indépendante du point 1.

⚠ Mesure non appliquée, laissée au user : nos hexagones sont **57 % plus
grands** que la référence (`HEX_R_WORLD = 48`, il faudrait ~31). Contredit
son réglage du même jour (+20 %), donc c'est son arbitrage, pas le nôtre.

## AV.3d — LE FLOU : deux défauts Pixi jamais réglés

Symptôme rapporté par le user : « un effet de blur produit par le sol
lorsqu'on joue », **invisible sur un arrêt sur image**. Ce dernier détail
est le diagnostic : un flou constant se voit sur une image fixe ; un flou
qui n'apparaît qu'en mouvement est du **crénelage de minification**.

**Cause 1 — `resolution` n'était jamais fixé.**
`AbstractRenderer.defaultOptions.resolution = 1`. Sur tout écran HiDPI
(n'importe quel Mac récent, `devicePixelRatio = 2`), on rend à la moitié
des pixels réels et le compositeur agrandit ×2. **Toute l'image est
ramollie, uniformément.** Correctif : `resolution: window.devicePixelRatio`
+ **`autoDensity: true`** (obligatoire : sans lui la taille CSS du canvas
suit le backing store et le jeu s'affiche ×2 trop grand).

**Cause 2 — la tuile était minifiée sans mipmap.**
362 texels pour 144 unités monde = 2,51 texels/unité, contre 1,3 pixel
écran/unité → **minification ×1,93**. Or `TextureSource.defaultOptions`
porte `mipLevelCount: 1` : aucun mipmap, donc un texel sur quatre est
échantillonné. Immobile ça tient, en mouvement ça rampe.

**Les deux se corrigent d'un coup** : rendre à la résolution du device
supprime l'agrandissement ET ramène la tuile à ~1 texel par pixel device,
où il n'y a plus rien à créneler.

⚠ **Vérifié, pas supposé** : `app.screen` est documenté **en pixels CSS**,
indépendant de `resolution` → `viewScale()` et le champ de vision sont
inchangés au bit près. C'était la condition bloquante : le FOV est un
invariant d'ÉQUITÉ (AF.3bis), pas un réglage cosmétique.

⚠ **Coût** : ×4 de travail fragment sur un écran ×2. Si le compteur AV.0
décroche des 60 fps, plafonner à 1.5 — **jamais revenir à 1**.

**Cause 3 (mineure, mon erreur)** : `shadowBlur` était à `0.28r`, soit
~15 px écran de dégradé doux autour de CHAQUE cellule — le sol n'avait
plus d'arêtes du tout. Ramené à `0.09r`. L'ombre de la référence est une
lèvre sombre fine, pas un halo : elle dit « en relief », pas « flou ».

## AV.3e — LE SOL N'A PAS CRÉÉ LE PROBLÈME, IL L'A RÉVÉLÉ

Le user rapporte, après AV.3d, un flou résiduel **et une sensation de
nausée**. Ce second mot déplace le diagnostic : une nausée en jeu vient du
**mouvement de caméra**, pas d'une texture molle.

**Deux causes distinctes, à ne pas confondre.**

**(a) Le flou résiduel — rééchantillonnage sous-pixel.** `camera()` posait
`world.position` à une valeur FRACTIONNAIRE. Le monde tombe donc sur une
phase sous-pixel différente à chaque frame et toutes les textures sont
rééchantillonnées 60 fois par seconde. Immobile : net. En mouvement : ça
NAGE. Ce n'est pas un réglage de filtrage, c'est l'offset qui ne tient
jamais en place. **Correctif : arrondir la translation aux pixels DEVICE**
(pas CSS — après AV.3d on rend à `devicePixelRatio`, arrondir en CSS
laisserait un demi-pixel device de tremblement). Coût : un demi-pixel CSS
de placement caméra, imperceptible.

**(b) LA VRAIE CAUSE DE FOND — la caméra dérive toute seule. NON CORRIGÉE.**
`CAMERA_RATE = 0.15` (`session.ts:117`) = lissage exponentiel, constante de
temps ~110 ms : la caméra traîne en permanence derrière la tête. Et
`session.ts:362` **resynchronise `predicted.x/y` sur la vérité serveur** —
or **A4.14 est OUVERT** : divergence médiane 25 px, max mesuré 218 px. À
chaque correction la cible saute, puis la caméra glisse ~110 ms. **Le décor
défile sans que le joueur ait rien demandé** : flux visuel découplé de
l'input = nausée, par définition.

**Pourquoi ça n'existait pas avant AV.1 :** le sol était un aplat + 900
points épars. Une glissade de caméra y était **invisible**. Sur une trame
régulière et contrastée, chaque micro-glissade devient lisible. Le motif
n'a rien cassé — il a rendu visible un défaut déjà là.

**Pourquoi slither ne l'a pas :** pas de réconciliation qui saute comme la
nôtre, et une caméra bien plus serrée.

**Atténuation appliquée (demande user)** : contraste du sol −20 %
(amplitude TOP↔GAP 17,8 → 14,2 en luminance, milieu ancré). Ça ne supprime
pas le mouvement, ça baisse le volume auquel le sol le rapporte.
**Mitigation, pas remède.**

**À TESTER ENSUITE, dans cet ordre :**
1. `CAMERA_RATE` 0.15 → 0.35 (caméra plus serrée, moins de glissade).
   Une ligne, réversible. ⚠ Change le FEELING de jeu → D85, essai à
   valider par le user, jamais imposé.
2. Si ça suffit, **le vrai correctif reste A4.14** (supprimer la
   divergence à la source). Régler la caméra ne fait que masquer un
   netcode qui saute.

## AV.3g — LA CAUSE RÉELLE : voile lumineux, pas flou. RÉSOLU.

**Trouvée par le user**, avec les interrupteurs B/G/P d'AV.3f : couper le
calque de halos (`G`) rend l'écran sain ; rien d'autre n'y change quoi que
ce soit. Ni le sol, ni la caméra.

**Ce n'était donc PAS du flou. C'était du VEILING GLARE.** La surface d'un
halo va comme le **carré** du rayon, et à `GLOW_SPREAD = 8` l'arithmétique
est accablante :

| réglage | 300 pastilles | 450 pastilles |
|---|---|---|
| spread 8 | **123 % de l'écran** | **184 %** |
| spread 4 | 31 % | 46 % |
| **spread 3** | **17 %** | 26 % |

L'écran entier était tapissé de lumière additive, plus d'une fois. La
lumière additive relève le niveau de noir **partout**, le contraste
s'effondre, et l'œil lit ça comme une image hors focus. AV.2b a ensuite
fait **respirer** ce tapis : c'est ce qui a transformé une image laide en
image nauséeuse.

**Le 3 est MESURÉ.** Profils radiaux de pastilles isolées dans la
référence — excès de luminance 100 / 91 / 71 / 48 / 22 / 1 % à 0, 2, 4, 6,
8, 10 px, sur un cœur de 2-4 px : leur halo meurt à **2 à 3 fois** le rayon
de la pastille. Les larges nappes colorées de leurs captures ne sont pas de
gros halos, ce sont **beaucoup de petits qui s'additionnent** là où les
pastilles s'agglutinent — comportement offert par le blending additif.

**Trois leçons de méthode, à ne pas perdre :**
1. **Mes trois diagnostics précédents étaient faux** (tuile trop molle,
   `resolution`, dérive caméra). Ils ont produit de vraies améliorations —
   `resolution: devicePixelRatio` et le snapping pixel restent des
   correctifs justes — mais **aucun n'était la cause**. Empiler des
   correctifs plausibles n'est pas un diagnostic.
2. **L'interrupteur a tranché en une minute** ce que trois cycles de
   raisonnement n'avaient pas trouvé. Face à un symptôme visuel diffus,
   construire l'A/B AVANT de corriger.
3. Le détail qui aurait dû mettre sur la voie dès le début : « ce n'est pas
   flagrant sur un arrêt sur image ». Un voile additif est *constant*, mais
   son caractère insupportable vient de la **pulsation** — donc invisible
   sur une image fixe. J'ai lu ce mot comme « crénelage de minification »
   et je m'y suis tenu trop longtemps.

## AV.3h — GLOW SUPPRIMÉ, et ce qu'il reste à faire du bouton B

**Décision user (2026-09-08), après tests et avis extérieurs d'amis : le
glow des pastilles est RETIRÉ**, pas seulement réduit. Réduit à 3 il était
tolérable ; sans lui le confort est meilleur, et c'est le critère qui prime
(D85 : l'expérience de jeu est le standard — « ça ressemble à la
référence » ne bat pas « on peut y jouer une heure »).

Tout le code du glow est supprimé : `makeGlowTexture`, `GlowView`,
`glowLayer`, `glowTexture`, `glowSprites`, `pulseGlows`, les constantes
`GLOW_*` et `PULSE_*`, les bascules `G` et `P`, et les entrées glow de
`addFood` / `removeFood` / `clear()` / `stats()`. **Une pierre tombale est
laissée dans `render.ts`** (section AV.2) avec la raison chiffrée : l'idée
est assez séduisante pour que quelqu'un veuille la reprendre, et la
contrainte à respecter alors est la **COUVERTURE TOTALE** (nombre × aire),
jamais l'aspect d'un halo isolé — c'est ce chiffre-là qui rendait le jeu
injouable, et il est invisible quand on inspecte un halo à la fois.

Fond conservé tel quel (`tiles`). Bascule `B` conservée.

### Le bouton B doit devenir une VRAIE préférence — pas encore fait

Avis donné au user, qu'il a suivi sur le principe :

**Pour :** l'épisode prouve que le confort visuel varie d'une personne à
l'autre ; le sol est purement décoratif ; **aucun enjeu d'équité** (à la
différence du champ de vision, AF.3bis).

**Ce qui manque avant que ce soit une fonctionnalité :**
1. **Persistance `localStorage`** — sinon le choix est perdu au rechargement
   et c'est une nuisance, pas un réglage.
2. **Retirer le bandeau de debug**, le remplacer par un retour discret.
3. **NE PAS garder `none` dans les trois choix proposés au joueur.** Tout
   AV.1 repose sur le constat qu'une trame RÉGULIÈRE est ce qui rend la
   vitesse lisible (les 900 points aléatoires n'y arrivaient pas).
   Proposer « aucun motif » laisse un joueur dégrader sa propre perception
   de vitesse sans le savoir. **Triplet proposé : `relief` / `plat` /
   `discret`** (même trame, contraste très réduit, pour ceux que les motifs
   fatiguent) — les trois gardent la référence de mouvement.
4. À terme : un menu de réglages. Une touche globale à une lettre est une
   ressource rare quand le jeu grandit.

## AV.1 — la note à ne pas redécouvrir

Le réseau hexagonal se répète sur `3R × √3·R`. Comme une texture fait un
nombre **entier** de pixels et que `√3` est irrationnel, **aucun rayon `R`
ne rend les deux côtés entiers**. Arrondir l'un des deux décale le point de
raccord par rapport à la géométrie dessinée : c'est exactement la couture
qu'on cherche à éviter.

**Méthode retenue — on inverse la dérivation.** On choisit d'abord les deux
tailles entières en pixels, avec un rapport aussi proche de `√3` qu'on
veut, puis on en déduit `R` :

- `362 / 209 = 1.7320574` contre `√3 = 1.7320508` → erreur relative `6.6e-6`
- `3R = 362` **exactement** (`R = 362/3`) et `1.5R = 181` **exactement**
- seul `√3·R = 209.0008` diffère de `TILE_H = 209` → **0.0008 px** de
  décalage au raccord vertical, sur toute la vie du jeu

L'erreur **ne s'accumule pas** : le GPU répète la tuile à l'identique, il ne
reconstruit jamais un réseau idéal. Le seul écart possible est ce 0.0008 px,
présent une fois, à chaque bord.

Seconde condition, indépendante de la première : chaque centre du réseau est
dessiné **neuf fois** (lui-même + les huit décalages voisins), sinon les
cellules à cheval sur le bord sont tranchées et le raccord se voit — l'artefact
de tuilage classique, qu'on confond facilement avec une mauvaise taille de tuile.

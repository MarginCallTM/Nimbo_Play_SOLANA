# promptnano.md — Brief de contexte pour IA générative (redesign du HERO)

> **À quoi sert ce fichier.** Le coller (en entier ou par blocs) dans une IA
> générative d'images (Nano Banana / Gemini, Midjourney, etc.) ou de design,
> pour qu'elle comprenne le produit AVANT de proposer un visuel de hero.
> Les blocs `PROMPT` en fin de fichier sont prêts à copier.
>
> Contexte de la mission : le front actuel a été jugé **hors-univers** par un
> web designer. On repart d'une nouvelle branche pour explorer une direction
> artistique cohérente avec le JEU. Rien n'est cassé sur `master`.

---

## 1. Le produit en une page

**Nimbo Play** est un **écosystème de jeux play-to-earn de SKILL sur Solana**.
Pas un casino : **joueur contre joueur**, jamais joueur contre la maison. Le
hasard n'existe pas dans le gameplay — c'est le niveau de jeu qui décide.

Le premier jeu s'appelle **Nimbo Arena** : un clone de *slither.io* en temps
réel, multijoueur, dans le navigateur.

**La boucle de jeu, en 4 temps :**

1. **Tu mises du SOL** pour entrer (paliers actuels : 0.1 / 0.25 / 0.5 / 1 SOL,
   plus un mode démo gratuit contre des bots). Plus tu mises, **plus ton
   serpent spawn gros** — donc plus puissant, mais plus lent à braquer et plus
   voyant. La mise est littéralement ton corps.
2. **Tu joues.** Tu manges des pellets, tu tues d'autres joueurs en les
   faisant percuter ton corps, tu grossis. Chaque pellet à l'écran **vaut du
   vrai SOL** — rien n'est décoratif, rien n'est créé à partir de rien.
3. **Tu meurs → tu perds tout.** 70 % de ta valeur tombe au sol sur ton
   cadavre (mangeable par tes assassins), 30 % est resemée sur la map. La
   déconnexion = mort immédiate. Pas de sauvegarde, pas de retour.
4. **Tu extrais.** Des **points d'extraction** apparaissent périodiquement sur
   la map. Te tenir dedans lance une **canalisation de 12 secondes** pendant
   laquelle tu ne peux pas fuir, tu es visible, tu es la cible la plus juteuse
   de l'arène. Si tu survies au timer, le SOL part sur ton wallet. Sinon, tout
   ce que tu as accumulé retombe au sol pour les autres.

**La tension centrale du jeu — c'est ÇA qu'un bon hero doit faire ressentir :**
> *« J'ai accumulé. Est-ce que je tente l'extraction maintenant, ou je continue
> encore un peu ? »*
> Le risque n'est pas abstrait : c'est de l'argent réel, visible à l'écran,
> attaché à un corps qui grossit et devient de plus en plus difficile à sauver.

---

## 2. La marque aujourd'hui

- **Nom :** *Nimbo Play* est l'**ombrelle** (le portail multi-jeux visé à long
  terme). *Nimbo Arena* est le **premier jeu**. Les domaines suivent :
  `nimboplay.dev` (portail) et `arena.nimboplay.dev` (le jeu), avec de la place
  pour `<jeu2>.nimboplay.dev` plus tard.
- **Étymologie :** « Nimbo » vient de *nimbus* — le nuage. D'où le logo actuel.
- **Logo actuel :** une icône en carré arrondi (style icône d'app iOS), fond
  dégradé bleu ciel, avec un **nuage cartoon dodu, blanc/bleu pâle, rempli
  d'eau** (une vague turquoise au milieu). Doux, rond, mignon, presque enfantin.
- **Typo actuelle :** Inter pour tout le corps de texte, **Fredoka** (ronde,
  ludique) réservée au nom de la marque.
- **Tagline actuelle :** « Bet and Play — your Skill Pays. »
- **Meta description actuelle :** *« Stake, play a real-time arena, and get paid
  on-chain in seconds. Gameplay runs off-chain; every stake and payout is
  settled by a Solana program. Live on devnet. »*

⚠️ **Le nuage est négociable.** Il vient du nom, pas d'un travail de marque.
Une nouvelle direction artistique peut le réinterpréter (orage, cumulonimbus
menaçant, nuage électrique, ciel de tempête…) ou l'abandonner. À toi de
trancher — mais si tu le gardes, il doit cesser d'être *mignon* : rien dans le
jeu n'est mignon.

---

## 3. À quoi ressemble VRAIMENT le jeu (= la source de vérité visuelle)

C'est le point le plus important du brief. **Le site doit ressembler à ça, pas
l'inverse.** Valeurs relevées directement dans le code du client (PixiJS/WebGL) :

| Élément | Couleur / traitement |
|---|---|
| Fond de l'arène | `#0b1020` — bleu nuit très sombre, presque noir |
| Bordure du monde | anneau `#4a5578`, gris-bleu froid |
| Grille de fond | points `#232c4a` (repères de mouvement discrets) |
| Serpent du joueur | corps `#2b6fd6`, tête `#3981f6` — bleu électrique |
| Serpent déconnecté | `#4a4f5c` / `#6a7080` — gris cadavre |
| Pellets ambiants | palette néon type Dracula : `#ff79c6` rose, `#8be9fd` cyan, `#50fa7b` vert, `#f1fa8c` jaune, `#bd93f9` violet, `#ffb86c` orange |
| Orbes de butin (cadavres, boost) | `#ffcc66` — **or**. L'or = de l'argent réel qui traîne par terre |
| Zone d'extraction | anneau or `#ffcc66`, qui **clignote en rouge `#ff4455`** dans les 3 dernières secondes avant d'exploser |
| Anneau de canalisation | vert `#50fa7b` qui se remplit dans le sens horaire |
| HUD / écrans de fin | **monospace**, texte `#e2e8f0`, overlay `rgba(11,16,32,0.92)`, verdict en 42px avec 8px de letter-spacing |
| Écran de mort | « GAME OVER » rouge / « EXTRACTED » vert, puis le montant en `◎0.0925 secured` |

**Le vocabulaire visuel qui en découle :** néon sur nuit profonde, glow, tracés
lumineux, monospace, symbole `◎` (le sigle SOL), lisibilité brutale, zéro
fioriture. C'est un jeu d'**arcade sous tension**, pas une app bancaire.

Autres repères de gameplay utiles pour un visuel juste :
- Le monde est un **disque** (rayon 1400 px), pas un rectangle. Il a une bordure
  létale : la toucher tue.
- Vue de dessus, caméra centrée sur le joueur, le reste de la map est dans le
  brouillard.
- Une minimap ronde en coin d'écran montre les points d'extraction en or.
- Il y a un **compteur de valeur** au-dessus de chaque serpent : tu vois combien
  vaut ta proie avant de l'attaquer.

---

## 4. Le front actuel et pourquoi il ne colle pas

**Stack :** Next.js 16 (App Router) + Tailwind v4 + shadcn/ui. Sections de la
homepage : Ticker → Header → **Hero** → HowItWorks → WhyNimbo → FAQ → Footer.

**Origine :** c'est un template Lovable au thème « candy / treasure » (univers
bonbons et coffres au trésor), conçu à l'époque où le projet était une
**loterie**, puis simplement **recolorié en bleu** après le pivot vers le jeu.
Le squelette n'a jamais été repensé.

**Ce que le hero contient aujourd'hui :**
- Fond **blanc**, dégradé radial bleu très pâle en haut.
- Un **gros nuage cartoon PNG** qui flotte en haut à gauche avec une ombre qui
  pulse.
- Une **pièce Solana** qui se balance en haut à droite.
- Un badge « Live on Solana devnet », un H1 « Bet and Play / your Skill Pays. »,
  un CTA bleu dégradé « Enter the Arena ».
- En dessous : un **globe terrestre interactif corporate** (librairie `cobe`,
  continents bleus sur océan blanc cassé, marqueurs de villes) et un **feed
  d'activité fictif** (fausses transactions, faux joueurs).
- Une rangée de logos partenaires (Phantom, Solflare, Jupiter, Backpack…).

**Le diagnostic, sans détour :**

1. **Décalage total d'univers.** Le site est blanc, pastel, arrondi, rassurant,
   fintech-SaaS. Le jeu est sombre, néon, rapide, cruel. Un joueur qui clique
   « Enter the Arena » change de planète.
2. **Le hero ne montre pas le jeu.** Un globe terrestre et un feed de
   transactions, c'est le hero d'une plateforme de paiement. On ne voit **jamais
   un serpent, jamais l'arène, jamais l'extraction** — c'est-à-dire jamais le
   produit.
3. **Vestiges de la loterie.** Le design system s'appelle encore « candy /
   treasure », des sections parlent encore de tickets et de tirages, la FAQ est
   restée celle de la loterie. Le nuage mignon et le coffre au trésor
   appartiennent à un produit qui n'est plus le produit principal.
4. **Ça ne promet pas la bonne émotion.** L'argument affiché est « c'est sûr,
   c'est transparent, c'est audité ». Le vrai argument du jeu est : **« tu peux
   tout perdre en une seconde, et c'est pour ça que c'est bon »**.

---

## 5. Palette et typo actuelles (à faire évoluer, pas forcément à jeter)

Le bleu de marque est solide et **il correspond déjà au serpent du joueur**
in-game. C'est le seul vrai point d'ancrage entre le site et le jeu — bonne
base pour reconstruire.

```
Primaire (bleu de marque)   oklch(0.62 0.19 259.81)  ≈ #3981f6
Primaire foncé              oklch(0.49 0.22 264.38)  ≈ #2249c8
Dégradé de marque           linear-gradient(135deg, #3981f6 → #2249c8)
Fond sombre du site         oklch(0.21 0.03 265)     ≈ #1a1d2e  (proche du #0b1020 du jeu)
Or (accent valeur)          oklch(0.85 0.14 85)      ≈ #ffcc66  ← même or que les orbes du jeu
Succès (vert)               oklch(0.72 0.18 160)
Danger (rouge)              oklch(0.64 0.21 25.33)
Rayon de bordure            0.625rem (formes plutôt rondes)
```

Typos : **Inter** (texte), **Fredoka** (marque, ronde et ludique). Le jeu, lui,
est intégralement en **monospace** — piste évidente pour rapprocher les deux.

---

## 7. Public et ton

**Qui :** joueurs crypto-natifs (Solana, wallets Phantom/Solflare), fans de
`.io` games et de jeux d'arcade compétitifs, communauté d'extraction shooters
(la mécanique « accumuler puis sortir vivant » vient de là). Plutôt jeunes,
plutôt à l'aise techniquement, habitués aux interfaces denses.

**Ce qu'ils veulent lire :** que le jeu est nerveux, que le risque est réel, que
la victoire vient du skill, que le paiement est instantané et vérifiable.

**Le ton :** direct, tendu, confiant. Phrases courtes. Pas de langue de bois
corporate, pas de mignonnerie, pas de hype crypto creuse (« revolutionary
web3 gaming paradigm » = à bannir).

**Références d'ambiance qui marchent :** slither.io / agar.io pour la lisibilité
arcade, Escape from Tarkov pour la tension de l'extraction, TRON / Geometry Wars
pour le néon vectoriel sur noir, les UI de terminal pour la crédibilité
technique.

---


## 9. TON IDÉE (à remplir avant d'envoyer)



---

---

# PROMPTS À COPIER

## PROMPT A — Visuel de hero (IA générative d'images)

> Copier tel quel, puis y ajouter ton idée de la section 9.

```
Design a hero section visual for "Nimbo Play", a skill-based play-to-earn arcade
game on the Solana blockchain. The game is a real-time multiplayer slither.io-style
arena where players stake real SOL: your snake's size IS your money. You grow by
eating glowing pellets and killing other players, and the only way to keep your
winnings is to reach an extraction point and survive a 12-second vulnerable
channeling timer. Die, and everything you accumulated drops on the floor for
your killers.

ART DIRECTION — this is an arcade under tension, never a casino, never a fintech app:
- Deep midnight-blue background (#0b1020), almost black, with a faint dotted grid.
- Neon vector aesthetic: glowing trails, bloom, luminous edges on pure darkness.
- The player's snake is electric blue (#3981f6 head, #2b6fd6 body).
- Ambient pellets scattered as small neon dots: hot pink #ff79c6, cyan #8be9fd,
  green #50fa7b, yellow #f1fa8c, purple #bd93f9, orange #ffb86c.
- Loot orbs are GOLD (#ffcc66) — gold always means real money lying on the ground.
- An extraction zone: a pulsing gold ring on the arena floor, with a green
  progress ring (#50fa7b) filling clockwise around a snake channeling inside it.
- Top-down camera, circular arena with a cold grey-blue lethal border (#4a5578).
- Optional HUD elements in monospace type: a value counter above a snake reading
  "◎0.42", a small circular minimap, a countdown.

MOOD: fast, dangerous, high-stakes, precise. The viewer should feel the moment of
decision — "extract now, or push my luck one more kill?".

STRICT CONSTRAINTS:
- NO casino imagery: no chips, no slot machines, no roulette, no jackpot, no dice,
  no stacks of cash, no coins raining.
- NO cute cartoon clouds, no pastel candy colors, no white corporate background.
- NO generic crypto clichés: no floating rings, no abstract blockchain cubes,
  no rocket ships, no bull imagery.
- NO photorealism, NO 3D render style. Flat/vector neon glow, game-native.
- Leave clear negative space on one side for a headline, a subtitle and one button.

FORMAT: wide 16:9 landscape hero image, high contrast, readable at small size.
```

### Variantes à tester (remplacer le paragraphe ART DIRECTION par une seule de ces intentions)

- **A1 — L'instant d'extraction.** Cadrage serré sur un serpent immobilisé dans
  l'anneau doré, anneau de progression vert à moitié rempli, trois serpents
  ennemis qui convergent depuis les bords du cadre. Tout le sujet est
  la vulnérabilité.
- **A2 — La carte-monde.** Vue de haut du disque complet de l'arène, une
  vingtaine de tracés lumineux en mouvement, deux points d'extraction dorés qui
  pulsent, la bordure létale visible. Le titre se pose dans le vide au centre.
- **A3 — Le cadavre.** Un serpent vient d'exploser en une traînée d'orbes dorés ;
  deux serpents plongent dessus. Raconte les 70/30 sans un mot.
- **A4 — Le poids de la mise.** Trois serpents côte à côte, de plus en plus gros,
  étiquetés ◎0.1 / ◎0.5 / ◎1. Montre que la mise est littéralement le corps.
- **A5 — Nimbo réinterprété.** Le nuage de la marque devenu **cumulonimbus
  d'orage** : masse sombre, éclairs bleu électrique, l'arène en contrebas.
  Garde le nom, tue la mignonnerie.

## PROMPT B — Direction artistique complète (IA texte / design)

> Pour obtenir une charte plutôt qu'une image.

```
You are a senior brand + product designer. Read the full context above about
Nimbo Play (a skill-based play-to-earn slither.io-style arena on Solana, where
the stake IS the snake and extraction is the only way out).

The current website is a recolored "candy / treasure" template: white background,
cute cartoon cloud, floating coin, corporate globe widget, fintech tone. The game
itself is a dark neon arcade (#0b1020 background, Dracula-palette neon pellets,
gold loot orbs, monospace HUD). The site and the game feel like two different
products.

Deliver a complete art direction to fix that, containing:
1. A one-sentence brand positioning statement.
2. Three distinct art direction routes, each with a name, a core idea, a mood
   description and what it deliberately sacrifices.
3. For your recommended route: a full color system (background, surface, primary,
   accent/value gold, success, danger, muted text) given as hex values, with
   contrast checked for accessibility.
4. A type pairing (display + body + monospace) with a rationale tied to the game's
   monospace HUD.
5. Three headline + subtitle options for the hero, in English, short and tense.
   No corporate filler, no crypto hype, no promised returns.
6. A wireframe description of the hero section: layout, hierarchy, what the visual
   is, where the CTA sits.
7. A recommendation on the logo: keep, reinterpret, or drop the cloud — with the
   reasoning.

HARD CONSTRAINTS: it runs on Solana DEVNET (no real money value) and must say so;
it is NOT a casino (player vs player skill, never house-banked); no fabricated
stats; cosmetics are never pay-to-win. SOL is written "◎".
```

---

## 10. Aide-mémoire chiffres (si l'IA en demande)

| Donnée | Valeur |
|---|---|
| Paliers de mise | ◎0.1 / ◎0.25 / ◎0.5 / ◎1 (+ démo gratuite contre bots) |
| Mise minimum serveur | 0.1 SOL |
| Rake maison | 5,5 % prélevé à l'entrée |
| Part reversée en pellets | 10 % de la mise, matérialisée immédiatement |
| Mort | 70 % sur le cadavre, 30 % resemée sur la map |
| Timer d'extraction | 12 secondes de canalisation vulnérable |
| Zone d'extraction | rayon 200 px, durée de vie ~40 s, explose à la fin |
| Rayon du monde | 1400 px (disque) |
| Réseau | Solana **devnet** |
| Sites | nimboplay.dev (portail) · arena.nimboplay.dev (le jeu) |
| Stack front | Next.js 16 · Tailwind v4 · shadcn/ui |
| Stack jeu | PixiJS (WebGL) · Colyseus · serveur autoritatif · programme Anchor |

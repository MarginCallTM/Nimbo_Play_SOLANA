# Variante 1 — L'anneau d'extraction

**Substitution :** la roulette → **la zone d'extraction** (anneau d'or au sol,
avec un **ver** en pleine canalisation à l'intérieur).

**Ce que ça raconte.** Le moment le plus tendu du jeu : tu as accumulé, tu es
entré dans l'anneau, l'arc vert se remplit, et pendant 12 secondes tu ne peux
pas fuir. C'est la promesse du produit résumée en une image.

**Où ça colle.** Le hero d'`arena.nimboplay.dev` (le jeu lui-même), ou la home
si tu veux que le portail vende d'abord Nimbo Arena.

**Pourquoi ça marche avec la référence.** La roulette est un **disque vu en
plongée trois-quarts**. L'anneau d'extraction aussi. La composition, la
perspective et l'éclairage arrière de l'image d'origine se transposent sans
rien recalculer.

**Ver, pas serpent (révision).** Le personnage est un **gros ver dodu et
sympathique**, pas un serpent. Raison : dans slither.io la créature est un ver,
et c'est ce qui donne au genre `.io` son ton joueur. Un serpent rend le visuel
trop sérieux, presque menaçant — le ver garde une ligne enfantine qui contraste
avec le fond sombre, exactement comme les jeux `.io` le font. C'est aussi
cohérent avec ton logo nuage, qui est doux lui aussi : le personnage porte la
douceur, le décor porte la tension.

**À surveiller.** Deux choses. (1) C'est la variante la plus proche du casino
d'origine (un disque, des petits ronds qui volent) — il faut que le **ver soit
lisible dans la silhouette**, sinon l'œil lira « roulette ». (2) Les modèles
d'images dérivent facilement vers le serpent réaliste : le prompt le bloque
explicitement, mais vérifie chaque rendu (pas d'écailles, pas de langue
fourchue, pas de tête triangulaire).

---

## PROMPT

```
A smooth, stylized, minimal graphic illustration featuring flat, vector-like shapes overlaid with a subtle, soft grainy texture. NO harsh black ink lines, NO comic-book hatching, and NO hyper-detailed line-work. The background is a solid, deeply textured, grainy dark void (#08080c). Dominating the center-bottom is a blazing backdrop of flat, stylized neon flames in smooth salmon-pink (#ff7878) and warm orange (#ff9e78) without complex shading, framed on the lower left and right corners by soft, pillowy, smooth smoke clouds in vibrant indigo (#4342d6) and neon purple (#673ab7). The central elements are positioned at the bottom center in front of the flames, bursting upwards with dynamic motion. The rendering uses bold, saturated flat colors with clean edges, utilizing soft grain rather than gritty halftone shading. The character design is friendly, chunky and playful, in the spirit of a modern browser .io game mascot. The overall mood is energetic, modern, and clean. NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no playing cards, no gems.

Color combination [ Background is deep grainy black (#08080c), flames are flat neon salmon-pink (#ff7878) and warm orange (#ff9e78), smoke is soft vibrant indigo (#4342d6) and neon purple (#673ab7) ]
Elements [ A large, elegant glowing golden ring at the bottom center — a wide flat circular platform ring in warm gold (#ffcc66), seen at a low three-quarter angle as if resting on a dark floor — with a big plump cartoon WORM coiled inside it, rearing playfully upward: a chunky tubular body made of soft rounded segments in electric blue (#3981f6) fading to deep blue (#2b6fd6), a simple rounded head with two large friendly dot eyes and a tiny smile. It is a cute worm, NOT a snake: no scales, no fangs, no forked tongue, no triangular head, no reptile markings. A thin bright green arc (#50fa7b) fills clockwise around the outer edge of the ring like a progress meter. The worm is surrounded by small floating orbs of light in neon pink, cyan, green, yellow, purple and orange, plus a few larger golden orbs drifting upward ]
Detail density [ Minimal to moderate, relying on bold, smooth shapes and soft gradients rather than intricate line-work or complex details ]
Empty space [ Top 55% visually empty; keep this area filled with the same deep grainy black (#08080c) texture, but place no flames, smoke, or floating debris there ]
Aspect ratio [ 16:9 ]
```

---

## Réglages à essayer si le premier jet ne va pas

- **Ça sort quand même un serpent :** renforce en ajoutant en fin de la
  description de style `The creature must look like the worm from slither.io:
  a soft rounded tube with a simple face, absolutely not a reptile.`
- **Ver illisible dans la silhouette :** remplacer `coiled inside it, rearing
  playfully upward` par `coiled twice inside the ring, its head raised high
  above the ring, clearly readable as a fat worm in silhouette`.
- **Trop enfantin / trop mignon :** supprimer `and a tiny smile` et remplacer
  `two large friendly dot eyes` par `two simple dot eyes`. Le corps dodu suffit
  à porter le ton, les yeux font le reste.
- **Pas assez enfantin :** ajouter `slightly oversized head, exaggerated chunky
  proportions, soft bouncy silhouette`.
- **Trop chargé :** supprimer `plus a few larger golden orbs drifting upward` et
  passer Detail density à `Minimal`.
- **Ajouter la menace :** ajouter en fin d'Elements `; three small dark worm
  silhouettes converging toward the ring from the edges of the flames`. C'est
  ce qui rééquilibre un personnage mignon — le danger vient des autres, pas de
  lui.
- **Basculer le halo en or** (l'or = argent réel dans le jeu) : remplacer dans
  les deux endroits `salmon-pink (#ff7878) and warm orange (#ff9e78)` par
  `warm gold (#ffcc66) and amber (#ffb86c)`.

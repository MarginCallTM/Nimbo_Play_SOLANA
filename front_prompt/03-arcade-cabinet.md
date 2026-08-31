# Variante 3 — La borne d'arcade

**Substitution :** la roulette → **une borne d'arcade rétro**, dont l'écran
affiche l'arène vue de dessus (serpents lumineux + anneau d'or).

**Ce que ça raconte.** Nimbo Play est une **ombrelle**, pas un seul jeu. La
borne dit « salle d'arcade » : plusieurs jeux, une seule maison. Ça prépare
visuellement le portail multi-jeux (D65 / A5.5) sans rien promettre de faux —
et l'écran de la borne montre le jeu qui existe déjà.

**Où ça colle.** Le hero de `nimboplay.dev`, le portail. C'est la variante la
plus juste pour la page d'accueil de la marque ombrelle.

**Pourquoi ça marche avec la référence.** La borne remplace la roulette comme
**objet-totem central** posé au sol, vu en plongée trois-quarts, éclairé par
l'arrière. Bonus : son écran devient une **seconde source de lumière** dans la
composition, ce que la roulette n'avait pas.

**À surveiller.** Deux pièges. (1) La borne peut virer **nostalgie années 80**
(néons roses, damier, chrome) — or ton produit est moderne, pas rétro : garde
les formes lisses et la palette imposée. (2) L'écran doit rester **lisible à
petite taille** : peu d'éléments, gros contraste, sinon ça devient une tache.

---

## PROMPT

```
A smooth, stylized, minimal graphic illustration featuring flat, vector-like shapes overlaid with a subtle, soft grainy texture. NO harsh black ink lines, NO comic-book hatching, and NO hyper-detailed line-work. The background is a solid, deeply textured, grainy dark void (#08080c). Dominating the center-bottom is a blazing backdrop of flat, stylized neon flames in smooth salmon-pink (#ff7878) and warm orange (#ff9e78) without complex shading, framed on the lower left and right corners by soft, pillowy, smooth smoke clouds in vibrant indigo (#4342d6) and neon purple (#673ab7). The central elements are positioned at the bottom center in front of the flames, bursting upwards with dynamic motion. The rendering uses bold, saturated flat colors with clean edges, utilizing soft grain rather than gritty halftone shading. The overall mood is energetic, modern, and clean. NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no playing cards, no gems.

Color combination [ Background is deep grainy black (#08080c), flames are flat neon salmon-pink (#ff7878) and warm orange (#ff9e78), smoke is soft vibrant indigo (#4342d6) and neon purple (#673ab7) ]
Elements [ A large retro arcade cabinet at the bottom center, seen at a low three-quarter angle, standing on a dark floor; its body is a clean simple silhouette in deep indigo (#2a2a6a) with soft rounded edges and no chrome and no decals; its glowing screen shows a simple top-down view of a circular neon arena — thin luminous blue and pink serpent trails curving around a small glowing golden ring (#ffcc66) on a dark blue field; small floating orbs of light in neon pink, cyan, green, yellow, purple and orange drift upward around the cabinet, with a few larger golden orbs (#ffcc66) ]
Detail density [ Minimal to moderate, relying on bold, smooth shapes and soft gradients rather than intricate line-work or complex details ]
Empty space [ Top 55% visually empty; keep this area filled with the same deep grainy black (#08080c) texture, but place no flames, smoke, or floating debris there ]
Aspect ratio [ 16:9 ]
```

---

## Réglages à essayer si le premier jet ne va pas

- **Trop rétro-80s :** ajouter en fin de la description de style `The cabinet
  must look modern and minimal, not 1980s nostalgia: no chrome, no checkerboard,
  no pink neon tubes, no retro typography.`
- **Écran illisible :** simplifier à `its glowing screen shows one thick neon
  blue serpent trail curving around a single glowing golden ring on a dark blue
  field` et passer Detail density à `Minimal`.
- **Idée « portail multi-jeux » plus explicite :** remplacer le début d'Elements
  par `Three retro arcade cabinets at the bottom center, one large in front and
  two smaller behind it, seen at a low three-quarter angle`. ⚠️ N'utilise cette
  version que quand un deuxième jeu existera vraiment — sinon c'est une promesse
  que le produit ne tient pas.
- **Sortir le serpent de l'écran** (effet surprise) : ajouter en fin d'Elements
  `; the blue serpent trail escapes the screen and coils out into the air above
  the cabinet`.

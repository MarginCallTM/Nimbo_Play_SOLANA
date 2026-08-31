# Variante 3d — La borne peinte, v2 (4 correctifs de composition)

> Fait suite à [03c-arcade-painterly.md](03c-arcade-painterly.md), dont le
> rendu **valide la direction artistique** : grain présent, nuages
> volumétriques avec liseré chaud, flammes en silhouettes noires découpées
> dans le halo coral, cœur blanc-chaud. `03`, `03b` et `03c` restent intacts.
>
> Ce fichier ne corrige que la **composition**. Le médium et la palette ne
> bougent pas.

---

## Ce qui restait à corriger

| # | Écart constaté sur le rendu 03c | Impact |
|---|---|---|
| 1 | **Sujet trop petit**, posé au centre d'une scène vide | 🔴 majeur |
| 2 | **Aucune profondeur de champ** : premier plan aussi net que le fond | 🟠 fort |
| 3 | **Symétrie parfaite** gauche/droite → image statique | 🟠 fort |
| 4 | **Ligne de sol visible** + ombre en triangle sous la borne | 🔴 majeur |
| 5 | Écran de la borne = tourbillon illisible | 🟡 mineur |
| 6 | Grosse orbe dorée plaquée sur le nuage de droite | 🟡 mineur |

Le **1** est le plus coûteux fonctionnellement : dans un hero, le titre se pose
au-dessus du sujet. Si le sujet est un petit objet flottant, le bloc de texte
n'a rien pour l'ancrer et la page paraît vide. Dans la référence, la roulette
occupe la moitié basse du cadre et **sort par le bord bas** — c'est cette masse
qui tient toute la composition.

Le **4** est un accident de rendu : la référence n'a pas de sol du tout, le
sujet **émerge de la fumée**. Un trait d'horizon net casse l'illusion
d'atmosphère qu'on vient de gagner.

---

## PROMPT

```
A rich painterly editorial illustration with an analog screen-printed poster feel. Soft airbrushed gradients and volumetric shading throughout — every shape has internal shading, soft falloff, and slightly irregular hand-painted edges. A heavy, fine analog film grain covers the ENTIRE image, including the black background. Muted, filmic, slightly desaturated color, like a printed poster rather than a screen. NOT flat vector art, NOT clean corporate illustration, NO crisp geometric edges, NO harsh black ink outlines, NO comic-book hatching, NO hyper-detailed line-work.

The background is a deep grainy near-black void (#08080c) with a soft vignette darkening the corners.

Dominating the center-bottom is a huge wall of glowing coral light (#f4695c fading to #ff9e78, with a near-white hot core at its base) filling the lower center of the frame. The flames are NOT drawn on top of the black: they are DARK NEGATIVE-SPACE SILHOUETTES bitten out of that glowing coral field — black flame-shaped forms eating into the light, with soft luminous edges where they meet. This fire is the main light source of the scene.

Framing the lower left and right corners and bleeding off the edges of the frame are enormous soft pillowy storm clouds in vibrant indigo (#4342d6) and violet (#673ab7). They are volumetric billowing masses with real internal shading and soft airbrushed edges — never stacked flat circles. They are lit from the center by the fire: warm pink rim light on the sides facing the flames, deep purple shadow on the sides facing away.

COMPOSITION IS ASYMMETRIC: the cloud mass on the left is noticeably larger, taller and pushed further into the frame than the one on the right. Never mirror the two sides.

STRONG DEPTH OF FIELD: the clouds in the extreme foreground, at the very bottom left and bottom right corners, are heavily BLURRED and out of focus, while the fire and the cabinet stay perfectly sharp. Some of the floating orbs nearest the viewer are also motion-blurred and out of focus.

NO VISIBLE FLOOR, NO GROUND PLANE, NO HORIZON LINE, NO CAST SHADOW ON THE GROUND: the cabinet rises directly out of the smoke clouds, its base dissolving into them.

Subject [ A MASSIVE retro arcade cabinet dominating the entire lower half of the frame, filling most of the width between the two cloud masses, seen at a low three-quarter angle from slightly below, and CROPPED BY THE BOTTOM EDGE of the image so that its base is out of frame. Its body is a deep indigo (#2a2a6a) with soft rounded edges, no chrome and no decals. It is backlit by the fire: a dark silhouetted body with a warm coral rim light running along its edges. Its large glowing screen shows a very simple, bold, readable image: one thick luminous blue worm trail and one thick pink worm trail curving around a single glowing golden ring (#ffcc66) on a dark blue field — few elements, high contrast, readable at small size. Small orbs of light in neon pink, cyan, green, yellow, purple and orange tumble upward around the cabinet with dynamic motion, scattered irregularly and unevenly, never evenly spaced, a few of them motion-blurred. Two or three larger golden orbs (#ffcc66) drift among them, spread apart in open dark space and never touching or overlapping the clouds ]

Empty space [ The top 40% of the frame is pure grainy black (#08080c): no flames, no clouds, no floating orbs. This is where the headline will sit ]
Aspect ratio [ 16:9 ]
```

---

## Les 4 correctifs, isolés

Si tu préfères repartir du prompt `03c` et n'ajouter que le manquant, voici les
blocs exacts. Ils sont volontairement **redondants et impératifs** : sur le
rendu précédent, le modèle a ignoré les consignes formulées en passant.

**1 — Sujet massif et coupé**
```
A MASSIVE retro arcade cabinet dominating the entire lower half of the frame,
filling most of the width between the two cloud masses, and CROPPED BY THE
BOTTOM EDGE of the image so that its base is out of frame.
```

**2 — Profondeur de champ**
```
STRONG DEPTH OF FIELD: the clouds in the extreme foreground, at the very bottom
left and bottom right corners, are heavily BLURRED and out of focus, while the
fire and the cabinet stay perfectly sharp.
```

**3 — Asymétrie et mouvement**
```
COMPOSITION IS ASYMMETRIC: the cloud mass on the left is noticeably larger and
taller than the one on the right. Never mirror the two sides. The floating orbs
tumble with dynamic motion, scattered irregularly and unevenly, a few of them
motion-blurred.
```

**4 — Pas de sol**
```
NO VISIBLE FLOOR, NO GROUND PLANE, NO HORIZON LINE, NO CAST SHADOW ON THE
GROUND: the cabinet rises directly out of the smoke clouds, its base dissolving
into them.
```

---

## Deux ajustements mineurs inclus

- **Écran lisible.** Le tourbillon abstrait devient une tache à taille réelle.
  Le prompt demande maintenant deux tracés épais autour d'un seul anneau doré,
  `readable at small size`. Si ça reste flou, la solution définitive est dans
  [03b](03b-arcade-cabinet-4k.md) : générer **écran éteint** et redessiner
  l'écran en vectoriel dans Figma.
- **Orbes dorées.** Elles sont désormais `spread apart in open dark space and
  never touching or overlapping the clouds` — la grosse orbe plaquée sur le
  nuage de droite ressemblait à une pièce collée.

---

## Note sur le vide en haut

Passé de 55 % à **40 %**, conséquence directe du correctif 1 : une borne qui
occupe la moitié basse remonte mécaniquement dans le cadre. 40 % de noir sur du
16:9 laisse encore la place au badge, au H1 sur deux lignes, au sous-titre et
aux boutons — c'est la proportion de la référence.

Si le titre finit à l'étroit, ne réduis pas le sujet : passe l'**aspect ratio à
21:9** et laisse l'illustration déborder. Un hero plein écran se recadre de
toute façon selon la hauteur du viewport.

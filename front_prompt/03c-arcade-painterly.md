# Variante 3c — La borne, en illustration PEINTE (correctif texture)

> Fait suite à [03b-arcade-cabinet-4k.md](03b-arcade-cabinet-4k.md), dont le
> résultat est **plus plat** que la référence. Les fichiers `03` et `03b`
> restent intacts.

---

## Ce qui s'est passé

**Le problème n'était pas la résolution.** C'était le vocabulaire de médium.

Le prompt d'origine — et pire, mon « Prompt B » du fichier `03b` — contient
`flat, vector-like shapes`, `razor-sharp clean edges`, `NO grain, NO texture,
NO noise`. Ces mots poussent le modèle vers de l'**illustration vectorielle
plate**, le style des banques d'images corporate. C'est exactement ce qui est
sorti.

Or la référence n'est **pas du vectoriel**. C'est une illustration **peinte à
l'aérographe**, grainée, avec une vraie source de lumière et de la profondeur
de champ. Demander « vector » et « no grain » revenait à demander l'inverse de
la cible.

**Les sept écarts, du plus au moins déterminant :**

| | Version plate | Référence |
|---|---|---|
| Médium | vectoriel, contours nets | peint, bords légèrement irréguliers |
| Grain | aucun | lourd, partout, y compris sur le noir |
| Lumière | aucune source | le feu éclaire tout, liseré rose sur les nuages |
| Profondeur | un seul plan | premier plan flou, vraie profondeur de champ |
| Nuages | cercles empilés, dégradé uniforme | masses volumétriques ombrées, débordent du cadre |
| Flammes | formes coral posées sur le noir | **silhouettes noires découpées dans un halo coral** |
| Sujet | petit, centré, entier | énorme, coupé par le bord bas |

Le point le plus contre-intuitif est celui des flammes : dans la référence,
elles ne sont pas dessinées. C'est un **aplat lumineux coral**, dans lequel des
formes **noires** viennent mordre. L'inversion figure/fond. Tant que le prompt
demande « des flammes », le modèle les peint en orange sur du noir et on perd
l'effet de halo venu de derrière.

---

## Solution 1 (la plus fiable) — édition d'image plutôt que génération

Nano Banana est d'abord un modèle **d'édition**. Donne-lui la référence en
entrée : il conservera le grain, les nuages, la lumière et la texture **à
l'identique**, puisqu'il ne les regénère pas.

```
Keep this image EXACTLY as it is — the same grain, the same painted texture, the
same clouds, the same flames, the same lighting and the same colors. Change ONE
thing only: replace the roulette wheel at the center with a retro arcade cabinet
seen at a low three-quarter angle, in deep indigo, its glowing screen showing a
top-down neon arena with luminous worm trails circling a small golden ring.
Replace the floating casino chips, dice and gems with small floating neon orbs
of light and a few larger golden orbs. Do not change anything else.
```

⚠️ **Deux limites.** (1) La texture héritée est celle d'une image d'environ
1900 px — il faudra quand même upscaler. (2) Le résultat est **dérivé d'une
image dont tu n'as pas les droits** : parfait pour valider la direction et
briefer un illustrateur, à refaire en original avant la mise en ligne
publique.

---

## Solution 2 — Prompt peint, sans référence

Prompt entièrement réécrit : plus un mot de « vector », le grain est de retour,
et on décrit **le médium, la lumière et la profondeur** au lieu des formes.

```
A rich painterly editorial illustration with an analog screen-printed poster feel. Soft airbrushed gradients and volumetric shading throughout — every shape has internal shading, soft falloff, and slightly irregular hand-painted edges. A heavy, fine analog film grain covers the ENTIRE image, including the black background. Muted, filmic, slightly desaturated color, like a printed poster rather than a screen. NOT flat vector art, NOT clean corporate illustration, NO crisp geometric edges, NO harsh black ink outlines, NO comic-book hatching, NO hyper-detailed line-work.

The background is a deep grainy near-black void (#08080c) with a soft vignette darkening the corners.

Dominating the center-bottom is a huge wall of glowing coral light (#f4695c fading to #ff9e78) filling the lower center of the frame. The flames are NOT drawn on top of the black: they are DARK NEGATIVE-SPACE SILHOUETTES bitten out of that glowing coral field — black flame-shaped forms eating into the light, with soft luminous edges where they meet. This fire is the only light source in the scene.

Framing the lower left and right corners and bleeding off the edges of the frame are enormous soft pillowy storm clouds in vibrant indigo (#4342d6) and violet (#673ab7). They are volumetric billowing masses with real internal shading and soft airbrushed edges — never stacked flat circles. They are lit from the center by the fire: warm pink rim light on the sides facing the flames, deep purple shadow on the sides facing away. The clouds closest to the viewer are noticeably OUT OF FOCUS and softly blurred, creating genuine depth of field.

Subject [ A large retro arcade cabinet standing at the bottom center on a dark floor, seen at a low three-quarter angle, LARGE in frame and cropped by the bottom edge. Its body is a deep indigo (#2a2a6a) with soft rounded edges, no chrome and no decals. It is backlit by the fire: a dark silhouetted body with a warm coral rim light along its edges. Its glowing screen shows a simple top-down view of a circular neon arena — thin luminous blue and pink worm trails curving around a small glowing golden ring (#ffcc66) on a dark blue field. Small floating orbs of light in neon pink, cyan, green, yellow, purple and orange drift upward around the cabinet, with a few larger golden orbs (#ffcc66), some of them softly out of focus ]

Empty space [ The top 50% of the frame is pure grainy black (#08080c): no flames, no clouds, no floating orbs ]
Aspect ratio [ 16:9 ]
```

---

## Les cinq mots qui font le travail

Si tu bricoles le prompt toi-même, ce sont ceux-là qui portent le style. Retire
n'importe lequel et tu retombes dans le plat.

1. `painterly` / `airbrushed` — le médium. **Le plus important.**
2. `volumetric shading` — les nuages cessent d'être des cercles.
3. `negative-space silhouettes bitten out of the glow` — l'inversion des flammes.
4. `out of focus` / `depth of field` — la profondeur.
5. `heavy analog film grain` — la matière. **Ne le retire plus.**

Et le mot à bannir : `vector`. Ainsi que ses cousins `flat`, `clean edges`,
`crisp`. Ils sont dans le prompt d'origine, ils sont ce qui t'a coûté la
texture.

---

## Sur la résolution — ce qui reste vrai

Le grain généré à ~1024 px reste plus grossier que celui de la référence. La
séquence qui donne le meilleur résultat :

1. Générer avec le prompt ci-dessus (grain compris, il fait partie du médium).
2. **Upscaler ×3** — Upscayl (gratuit, local, macOS) suffit sur ce type d'image.
3. Si le grain ressort trop gros après upscale : le **retirer** au flou de
   surface, puis en **remettre un fin en CSS** (l'overlay `feTurbulence` est
   dans [03b](03b-arcade-cabinet-4k.md)). Le grain CSS est net à toutes les
   densités d'écran, y compris Retina.
4. Exporter en **WebP** ou **AVIF**, jamais en PNG.

---

## Si ça ne suffit toujours pas

Il faut regarder la référence pour ce qu'elle est : très probablement le travail
d'un **illustrateur humain**, pas une génération. Le rendu à l'aérographe, la
cohérence de l'éclairage et la profondeur de champ sont exactement ce que les
modèles rendent le moins bien.

Deux voies réalistes :

- **Générer puis retoucher.** Prendre le meilleur jet, et reprendre à la main
  dans Photoshop/Procreate ce qui fait défaut : liseré chaud sur les nuages,
  flou de premier plan, grain final. Deux heures de retouche valent dix
  regénérations.
- **Briefer un illustrateur.** Sur Dribbble ou Behance, en cherchant
  « editorial illustration », « risograph », « grainy gradient ». Compter
  300–800 € pour un hero de ce niveau. Les fichiers `promptnano.md` et
  `03c` constituent déjà le brief : tu as la palette, le sujet, la
  composition et les contraintes.

Vu que le hero est **la première chose que voit un joueur** et qu'il sert la
marque entière, c'est probablement la ligne de budget la plus rentable du
projet front.

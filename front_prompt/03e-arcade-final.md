# Variante 3e — La borne peinte, v3 (mur de feu restauré)

> Fait suite à [03d-arcade-painterly-v2.md](03d-arcade-painterly-v2.md), dont
> le rendu est **le meilleur à ce jour** : sujet massif coupé par le bord bas,
> plus de ligne de sol, liseré coral sur les arêtes, écran lisible.
> `03`, `03b`, `03c` et `03d` restent intacts.
>
> Ce fichier corrige **une seule chose** : le mur de feu, qui a rétréci quand
> la borne a grossi. Deux consignes que le modèle ignore systématiquement sont
> **retirées du prompt** et basculées en post-production.

---

## Ce qui change et pourquoi

### 🔴 Le correctif — le mur de feu

Sur le rendu 03d, la borne « filling most of the width between the two cloud
masses » a mécaniquement **chassé le feu** : l'aplat coral s'est réduit à un
halo bas, et au-dessus on est revenu à des langues de flammes posées sur du
noir. L'inversion figure/fond — le cœur du style de la référence — est perdue
dans la moitié haute.

Le prompt dit maintenant explicitement que **le mur de lumière est plus grand
que la borne**, et que la borne se détache **en silhouette dessus**. Sans ce
rapport de taille énoncé, le modèle dimensionne le feu d'après ce qui reste de
place une fois le sujet posé.

### ✂️ Deux consignes retirées

| Consigne | Pourquoi elle sort |
|---|---|
| `STRONG DEPTH OF FIELD` | **Ignorée 3 fois de suite.** Dans un rendu en aplats, le modèle n'a pas de séparation de plans à flouter. Chaque phrase inutile dilue le poids des autres. → **post-production** |
| Grosses orbes dorées | **Ignorées 2 fois** : elles finissent plaquées sur un nuage, comme une pièce collée. → **post-production** |

Ce n'est pas un abandon, c'est un déplacement : les deux se font mieux à la
main, et en deux minutes. Voir la section post-production plus bas.

---

## PROMPT

```
A rich painterly editorial illustration with an analog screen-printed poster feel. Soft airbrushed gradients and volumetric shading throughout — every shape has internal shading, soft falloff, and slightly irregular hand-painted edges. A heavy, fine analog film grain covers the ENTIRE image, including the black background. Muted, filmic, slightly desaturated color, like a printed poster rather than a screen. NOT flat vector art, NOT clean corporate illustration, NO crisp geometric edges, NO harsh black ink outlines, NO comic-book hatching, NO hyper-detailed line-work.

The background is a deep grainy near-black void (#08080c) with a soft vignette darkening the corners.

THE FIRE IS A HUGE WALL OF LIGHT, NOT A GROUP OF FLAMES. A vast glowing field of coral light (#f4695c fading to #ff9e78, with a near-white hot core at its base) spreads across the entire center of the frame BEHIND everything else. This wall of light is WIDER AND TALLER THAN THE CABINET: it rises high above the cabinet's top edge and spreads well beyond it on both sides, reaching up into the upper third of the frame. The cabinet is SILHOUETTED against this glowing wall.

The flames are NOT drawn on top of the black background and are NEVER separate flame tongues floating in the dark. They are DARK NEGATIVE-SPACE SILHOUETTES bitten out of the glowing coral field — black flame-shaped forms eating into the light from above, with soft luminous edges where black meets glow. This wall of fire is the main light source of the whole scene.

Framing the lower left and right corners and bleeding off the edges of the frame are enormous soft pillowy storm clouds in vibrant indigo (#4342d6) and violet (#673ab7). They are volumetric billowing masses with real internal shading and soft airbrushed edges — never stacked flat circles. They are lit from the center by the fire: warm pink rim light on the sides facing the flames, deep purple shadow on the sides facing away.

COMPOSITION IS ASYMMETRIC: the cloud mass on the left is noticeably larger, taller and pushed further into the frame than the one on the right. Never mirror the two sides.

NO VISIBLE FLOOR, NO GROUND PLANE, NO HORIZON LINE, NO CAST SHADOW ON THE GROUND: the cabinet rises directly out of the smoke clouds, its base dissolving into them.

Subject [ A MASSIVE retro arcade cabinet dominating the lower half of the frame, seen at a low three-quarter angle from slightly below, and CROPPED BY THE BOTTOM EDGE of the image so that its base is out of frame. Its body is a deep indigo (#2a2a6a) with soft rounded edges, no chrome and no decals; its large side panel carries a soft internal gradient from lighter indigo near the fire to deep shadow away from it, never a flat empty dark plane. It is backlit: a dark silhouetted body with a warm coral rim light running along all its edges. Its glowing screen shows a very simple, bold, readable image: one thick luminous blue worm trail and one thick pink worm trail curving around a single glowing golden ring (#ffcc66) on a dark blue field — few elements, high contrast, readable at small size. Small orbs of light in neon pink, cyan, green, yellow, purple and orange tumble upward around the cabinet with dynamic motion, scattered irregularly and unevenly, never evenly spaced, a few of them motion-blurred ]

Empty space [ The top 35% of the frame is grainy black (#08080c), with only the soft upper glow of the fire wall bleeding into it. No clouds, no cabinet, no floating orbs. This is where the headline will sit ]
Aspect ratio [ 16:9 ]
```

---

## Post-production — les 3 gestes qui finissent l'image

À faire dans Photoshop, Affinity, Figma ou Procreate. Compter 10 minutes.

**1. Flou de premier plan (la profondeur de champ).**
Sélectionner les nuages du **bas-gauche** et du **bas-droite**, ceux qui touchent
les bords du cadre. Flou gaussien 8 à 15 px selon la résolution. Ne rien flouter
d'autre : le feu et la borne restent parfaitement nets. C'est ce seul geste qui
crée l'illusion d'espace.

**2. Les grosses orbes dorées.**
Les dessiner à la main, dans le **noir ouvert** de la moitié haute, jamais
au-dessus d'un nuage. Cercle doré `#ffcc66`, léger dégradé, halo flou par
en-dessous. Deux ou trois suffisent, de tailles différentes, jamais alignées.

**3. Le grain final.**
Après l'upscale seulement. Soit un calque de bruit en mode **Superposition** à
10–20 %, soit — mieux — l'overlay CSS `feTurbulence` fourni dans
[03b](03b-arcade-cabinet-4k.md), qui reste net sur écran Retina.

Puis : upscale ×3 (Upscayl), export **WebP** ou **AVIF**.

---

## Quand s'arrêter

Le rendu 03d était déjà exploitable. Ce prompt vise **le dernier écart visible**
avec la référence — pas la perfection.

Si le prochain jet garde le mur de feu haut et large, **c'est terminé** : passe
en post-production et attaque le reste de la page. Au-delà, tu entres dans les
rendements décroissants — chaque consigne supplémentaire affaiblit les
précédentes, et tu l'as déjà constaté trois fois avec la profondeur de champ.

Le vrai levier restant n'est plus le prompt, c'est la **retouche manuelle** —
ou un illustrateur, si tu veux atteindre exactement le niveau de la référence
(cf. la fin de [03c](03c-arcade-painterly.md)).

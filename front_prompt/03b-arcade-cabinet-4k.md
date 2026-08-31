# Variante 3b — La borne d'arcade, version haute qualité

> **Ne remplace pas [03-arcade-cabinet.md](03-arcade-cabinet.md).** Le prompt
> d'origine a donné un rendu que tu valides — il reste intact dans son fichier.
> Ici on ne cherche qu'une chose : **la même image, en meilleure qualité de
> texture**. Le bloc `Elements` est repris **au caractère près** (y compris
> `serpent trails`, puisque c'est ce qui a produit le rendu que tu aimes).
> Seul le vocabulaire de qualité change.

---

## ⚠️ Lis ça avant de relancer une génération

**La résolution ne se demande pas dans le prompt.** Nano Banana / Gemini
produisent une image à une résolution native fixe (de l'ordre de 1024 à
2048 px de large selon le modèle). Écrire « 4K », « 8K » ou « 300 dpi » ne
change **pas** le nombre de pixels rendus — ces mots agissent seulement comme
un *style* : ils poussent le modèle vers des images qui « ressemblent » à des
rendus haute qualité. Aucun prompt ne fera sortir du vrai 4K d'un modèle qui
ne le génère pas.

**Et surtout : c'est ton grain qui te trahit.** Le prompt d'origine demande
`overlaid with a subtle, soft grainy texture`. À 1024 px, un modèle ne sait pas
faire du grain fin — il fait du **bruit gros et pâteux**, qui devient
franchement moche dès que l'image est agrandie pour couvrir un hero en pleine
largeur. Plus tu insistes sur le grain dans le prompt, pire c'est. C'est très
probablement exactement ce que tu constates.

**La bonne méthode, celle des studios :**

1. Générer l'illustration **propre, sans grain**, en aplats nets → **Prompt B**.
2. **Upscaler** l'image (Upscayl gratuit, Real-ESRGAN, Topaz, Magnific).
3. Ajouter le grain **à la fin**, à la résolution finale — en CSS sur le site,
   ou en calque Photoshop/Figma. Un grain appliqué en dernier est toujours plus
   fin et plus régulier qu'un grain généré.

Le **Prompt A** reste dispo si tu veux tenter le tout-en-un sans
post-traitement. Le **Prompt B** est celui que je te recommande.

---

## PROMPT A — même image, vocabulaire de qualité poussé

Garde le grain généré, mais ajoute les termes qui poussent le modèle vers des
aplats nets et des dégradés lisses.

```
An ultra high quality, print-grade, smooth stylized minimal graphic illustration featuring flat, vector-like shapes with razor-sharp clean edges, overlaid with an extremely fine, subtle film grain. Crisp, high fidelity, perfectly smooth gradients with no banding, no posterization, no blur, no muddy noise, no compression artifacts. NO harsh black ink lines, NO comic-book hatching, and NO hyper-detailed line-work. The background is a solid, deeply textured, finely grained dark void (#08080c). Dominating the center-bottom is a blazing backdrop of flat, stylized neon flames in smooth salmon-pink (#ff7878) and warm orange (#ff9e78) without complex shading, framed on the lower left and right corners by soft, pillowy, smooth smoke clouds in vibrant indigo (#4342d6) and neon purple (#673ab7) with silky clean gradient falloff. The central elements are positioned at the bottom center in front of the flames, bursting upwards with dynamic motion. The rendering uses bold, saturated flat colors with immaculate clean edges, using ultra-fine grain rather than gritty halftone shading. The overall mood is energetic, modern, and clean. Poster quality, professional editorial illustration, maximum resolution and sharpness. NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no playing cards, no gems.

Color combination [ Background is deep grainy black (#08080c), flames are flat neon salmon-pink (#ff7878) and warm orange (#ff9e78), smoke is soft vibrant indigo (#4342d6) and neon purple (#673ab7) ]
Elements [ A large retro arcade cabinet at the bottom center, seen at a low three-quarter angle, standing on a dark floor; its body is a clean simple silhouette in deep indigo (#2a2a6a) with soft rounded edges and no chrome and no decals; its glowing screen shows a simple top-down view of a circular neon arena — thin luminous blue and pink serpent trails curving around a small glowing golden ring (#ffcc66) on a dark blue field; small floating orbs of light in neon pink, cyan, green, yellow, purple and orange drift upward around the cabinet, with a few larger golden orbs (#ffcc66) ]
Detail density [ Minimal to moderate, relying on bold, smooth shapes and soft gradients rather than intricate line-work or complex details; every shape must be crisply defined ]
Empty space [ Top 55% visually empty; keep this area filled with the same deep, finely grained black (#08080c) texture, but place no flames, smoke, or floating debris there ]
Aspect ratio [ 16:9 ]
```

---

## PROMPT B — version propre, sans grain (recommandé)

Le grain sera ajouté après, au propre. Le modèle n'a plus qu'un seul travail :
des aplats nets. C'est là qu'il est le meilleur.

```
An ultra high quality, print-grade, smooth stylized minimal graphic illustration featuring flat, vector-like shapes with razor-sharp clean edges and perfectly smooth gradients. Completely clean digital vector artwork: NO grain, NO noise, NO texture overlay, NO banding, NO posterization, NO blur, NO compression artifacts. NO harsh black ink lines, NO comic-book hatching, and NO hyper-detailed line-work. The background is a solid, flat, pure dark void (#08080c). Dominating the center-bottom is a blazing backdrop of flat, stylized neon flames in smooth salmon-pink (#ff7878) and warm orange (#ff9e78) without complex shading, framed on the lower left and right corners by soft, pillowy, smooth smoke clouds in vibrant indigo (#4342d6) and neon purple (#673ab7) with silky clean gradient falloff. The central elements are positioned at the bottom center in front of the flames, bursting upwards with dynamic motion. The rendering uses bold, saturated flat colors with immaculate clean edges. The overall mood is energetic, modern, and clean. Poster quality, professional editorial vector illustration, maximum resolution and sharpness. NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no playing cards, no gems.

Color combination [ Background is flat deep black (#08080c), flames are flat neon salmon-pink (#ff7878) and warm orange (#ff9e78), smoke is soft vibrant indigo (#4342d6) and neon purple (#673ab7) ]
Elements [ A large retro arcade cabinet at the bottom center, seen at a low three-quarter angle, standing on a dark floor; its body is a clean simple silhouette in deep indigo (#2a2a6a) with soft rounded edges and no chrome and no decals; its glowing screen shows a simple top-down view of a circular neon arena — thin luminous blue and pink serpent trails curving around a small glowing golden ring (#ffcc66) on a dark blue field; small floating orbs of light in neon pink, cyan, green, yellow, purple and orange drift upward around the cabinet, with a few larger golden orbs (#ffcc66) ]
Detail density [ Minimal to moderate, relying on bold, smooth shapes and soft gradients rather than intricate line-work or complex details; every shape must be crisply defined ]
Empty space [ Top 55% visually empty; keep this area filled with flat pure black (#08080c), but place no flames, smoke, or floating debris there ]
Aspect ratio [ 16:9 ]
```

---

## Remettre le grain après (2 options)

### Option 1 — en CSS, sur le site (gratuit, net à toutes les résolutions)

Le grain est généré par le navigateur en SVG, donc il est **parfaitement fin
quel que soit l'écran**, y compris en Retina. Meilleure qualité possible, et ça
pèse quelques octets.

```html
<!-- Overlay à poser au-dessus du hero, en pointer-events:none -->
<div class="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
     style="background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E&quot;)">
</div>
```

Réglages : `baseFrequency` plus haut → grain plus fin ; `opacity` entre `0.12`
et `0.25` selon le goût. Teste sur écran Retina, c'est là que ça se voit.

### Option 2 — en amont, dans Photoshop / Figma / Affinity

Calque de bruit au-dessus de l'illustration, mode de fusion **Superposition**
ou **Lumière tamisée**, opacité 10–20 %. Le faire **après** l'upscale, jamais
avant — sinon l'upscaler lisse le grain et le rend flou.

---

## Upscaler avant de mettre en ligne

Ton hero fait toute la largeur de l'écran : sur un 27" Retina il faut viser
~3840 px de large. Génération native ~1024–2048 px → il manque un facteur 2 à 4.

- **Upscayl** — gratuit, open source, tourne en local sur macOS. Suffisant ici.
- **Real-ESRGAN** — le moteur derrière, en ligne de commande.
- **Topaz Gigapixel** — payant, meilleur résultat.
- **Magnific / Krea** — en ligne, payant, très bons sur l'illustration.

Un point qui joue en ta faveur : ton image est faite d'**aplats et de dégradés
lisses**, c'est le cas le plus facile pour un upscaler. Les modèles galèrent sur
les textures et les détails fins — tu n'en as pas. C'est exactement pour ça que
générer **sans** grain donne un meilleur résultat final.

**Format de sortie :** exporte en **WebP** ou **AVIF**, jamais en PNG. Un PNG 4K
de dégradés pèse plusieurs Mo et plomberait le chargement de la home.

---

## Si l'écran de la borne reste flou après upscale

C'est la zone la plus fine de l'image, donc la première à se dégrader. Solution
propre, et qui règle le problème définitivement : générer la borne **écran
éteint** (ajouter `its screen is dark and switched off` dans Elements), puis
**redessiner l'écran en vectoriel** dans Figma par-dessus. Net à l'infini, et tu
peux le mettre à jour quand le jeu évolue, sans regénérer l'illustration.

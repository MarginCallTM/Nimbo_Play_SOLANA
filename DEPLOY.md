# Déploiement de l'arène en une commande (Docker)

LINK: https://167.233.250.97.sslip.io/

ssh root@167.233.250.97    

Objectif : lancer tout l'environnement jouable (serveur de jeu + client
web + settlement) avec **une seule commande**, en local comme sur un VPS,
pour faire tester le jeu à des amis sur devnet.

> Périmètre : cœur jouable uniquement (pas l'indexer/Postgres). Accès en
> `http` sur IP. RPC devnet public. Pour changer ça, voir la fin.

---

## 1. Prérequis (une fois)

- **Docker** + **Docker Compose v2** installés (`docker compose version`).
- La **FoodReserve** initialisée une fois pour toutes (le premier appelant
  en devient l'autorité — à faire juste après le premier déploiement du
  programme). Depuis la racine du repo :
  ```
  yarn ts-mocha -p ./tsconfig.json -t 1000000 scripts/init-arena-devnet.ts
  ```
- La **clé authority** (celle qui ouvre les rounds et paie les gains).
  En local c'est `~/.config/solana/id.json`.

> **AF.1 (2026-08-17) — plus de round à ouvrir à la main.** Le serveur
> gère lui-même le cycle de vie des rounds : il en ouvre un s'il n'y en a
> pas, ouvre le suivant avant l'échéance du courant, et ferme l'ancien
> quand plus personne n'y joue. `ROUND_ID` est donc **facultatif** :
> renseigné, il adopte ce round-là au démarrage ; vide, il en ouvre un.
> Le script ci-dessus ne sert plus qu'à la FoodReserve.
>
> La signature reste chez le service settlement (seul détenteur de la
> clé) : le serveur ne fait que déposer des demandes dans une file, que
> le settlement vient chercher. **Si le settlement ne tourne pas, aucun
> round ne s'ouvre** — le serveur reste en free-only et le dit dans ses
> logs.

## 2. Configuration (une fois)

```
cp .env.example .env
```
Puis éditer `.env` :

| Variable | Local | VPS |
|---|---|---|
| `PUBLIC_HOST` | `localhost` | l'IP publique du VPS |
| `ROUND_ID` | facultatif (vide = le serveur en ouvre un) | idem |
| `SETTLEMENT_SECRET` | `openssl rand -hex 32` | idem (obligatoire) |
| `AUTHORITY_KEYPAIR_HOST` | chemin de ta clé | chemin de la clé sur le VPS |

⚠️ **`SETTLEMENT_SECRET` est obligatoire** ici : le serveur et le
settlement sont deux conteneurs séparés (donc pas « en local » l'un pour
l'autre), et le serveur refuse `/settlement/*` aux appelants non-loopback
sans secret. Les deux services le partagent via `.env`.

La clé authority : soit tu pointes `AUTHORITY_KEYPAIR_HOST` directement
sur `~/.config/solana/id.json`, soit tu la copies dans `./secrets/` :
```
mkdir -p secrets && cp ~/.config/solana/id.json secrets/authority.json
```
(`secrets/` est ignoré par git — voir `.gitignore`.)

## 3. Lancer

```
docker compose up --build
```
- `--build` est nécessaire **au premier lancement** et à **chaque
  changement de `PUBLIC_HOST`/`SERVER_PORT`** : l'URL du serveur est
  *gravée dans le client au build* (contrainte de Vite).
- Ensuite, `docker compose up -d` suffit (démarrage en arrière-plan).

Vérifier :
```
docker compose ps                 # tout doit être "running"/"healthy"
docker compose logs -f server     # attendre "[chain] round N loaded"
```

Jouer : ouvrir `http://<PUBLIC_HOST>:<CLIENT_PORT>` (par défaut
`http://localhost:8080`). Sur IP publique + `http`, Phantom peut afficher
un avertissement « site non sécurisé » — normal en devnet, on passe.

## 4. Commandes utiles

```
docker compose down               # tout arrêter (les dettes survivent)
docker compose logs -f settlement # suivre les paiements
docker compose --profile full up  # ajouter Postgres (indexer/historique)
```

Les **dettes** (créances d'extraction/refund), le **journal anti-rejeu**
et la **file d'opérations de round** vivent dans un volume Docker
(`arena_data`) : un redémarrage n'oublie ni qui doit être payé, ni quelles
signatures de dépôt ont déjà servi, ni quel round il était en train
d'ouvrir.

### Réglages de rotation (AF.1)

| Variable | Défaut | Rôle |
|---|---|---|
| `ROUND_DURATION_S` | `86400` (24 h) | durée pendant laquelle un round accepte des dépôts |
| `ROTATION_MARGIN_S` | `1800` (30 min) | combien de temps AVANT l'échéance son successeur ouvre et prend la main |
| `DRAIN_GRACE_S` | `1800` (30 min) | combien de temps les retardataires peuvent encore jouer après l'échéance, avant fermeture forcée (= mort, après 2 avertissements) |
| `ROUND_AUTOROTATE` | `1` | `0` fige le serveur sur `ROUND_ID` (ancien comportement manuel) |

⚠️ Ces valeurs sont des **secondes**. Les défauts du code sont ceux de
production ; toute valeur courte (test) doit vivre dans `.env` et être
retirée avant un déploiement réel.

## 5. Aller plus loin (plus tard, sans tout refaire)

- **HTTPS + nom de domaine** : ajouter un reverse-proxy (Caddy) devant
  `server` et `client` — Caddy gère le certificat Let's Encrypt tout
  seul. `PUBLIC_HOST` devient le domaine, ports 443.
- **RPC dédié** : mettre l'endpoint Helius/QuickNode dans `RPC_URL`.
- **Indexer/stats** : profil `full` + dockeriser `backend/` (Rust).

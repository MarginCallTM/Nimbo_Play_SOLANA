# Déploiement de l'arène en une commande (Docker)

Objectif : lancer tout l'environnement jouable (serveur de jeu + client
web + settlement) avec **une seule commande**, en local comme sur un VPS,
pour faire tester le jeu à des amis sur devnet.

> Périmètre : cœur jouable uniquement (pas l'indexer/Postgres). Accès en
> `http` sur IP. RPC devnet public. Pour changer ça, voir la fin.

---

## 1. Prérequis (une fois)

- **Docker** + **Docker Compose v2** installés (`docker compose version`).
- Un **round on-chain ouvert** sur devnet. Depuis la racine du repo :
  ```
  yarn ts-mocha -p ./tsconfig.json -t 1000000 scripts/init-arena-devnet.ts
  ```
  Noter le `ROUND_ID` imprimé. (Un round devnet vit ~24 h ; à refaire
  quand le serveur logue « Ended ».)
- La **clé authority** (celle qui a ouvert le round et qui paiera les
  gains). En local c'est `~/.config/solana/id.json`.

## 2. Configuration (une fois)

```
cp .env.example .env
```
Puis éditer `.env` :

| Variable | Local | VPS |
|---|---|---|
| `PUBLIC_HOST` | `localhost` | l'IP publique du VPS |
| `ROUND_ID` | le numéro de l'étape 1 | idem |
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

Les **dettes** (créances d'extraction/refund) et le **journal anti-rejeu**
vivent dans un volume Docker (`arena_data`) : un redémarrage n'oublie ni
qui doit être payé, ni quelles signatures de dépôt ont déjà servi.

## 5. Aller plus loin (plus tard, sans tout refaire)

- **HTTPS + nom de domaine** : ajouter un reverse-proxy (Caddy) devant
  `server` et `client` — Caddy gère le certificat Let's Encrypt tout
  seul. `PUBLIC_HOST` devient le domaine, ports 443.
- **RPC dédié** : mettre l'endpoint Helius/QuickNode dans `RPC_URL`.
- **Indexer/stats** : profil `full` + dockeriser `backend/` (Rust).

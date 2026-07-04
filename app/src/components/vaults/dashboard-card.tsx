"use client";

// Wallet dashboard card shown inside the "Open my dashboard" modal.
// Adapted from a provided insurance-card snippet: same layout (avatar +
// badge + QR header, two-column grid, copy rows, separator, details,
// full-width action + in-card confirm overlay), recontented for the
// lottery universe. ALL data is MOCK until wallet adapter (10.6) and
// indexer reads (10.17) land.
// Changes vs the snippet: framer-motion -> motion/react, variants typed
// as Variants (else `type: "spring"` fails TS), motion props moved off
// <Button> onto motion.div wrappers (Button doesn't accept them), the
// Unsplash avatar photo replaced by wallet-initials fallback.
import { useEffect, useState } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Copy,
  Shield,
  Ticket,
  Calendar,
  Globe,
  User,
  CreditCard,
  X,
  Check,
} from "lucide-react";

// Mock wallet/tickets snapshot — mirrors my-tickets-dashboard.tsx data.
const WALLET_SHORT = "7xKq…9fPa";
const WALLET_FULL = "7xKq9fPaBv2mhLZ43nRekQ8w";
const LATEST_TICKET = "T-2481";
const ACTIVE_VAULT = "Daily Vault · Round #248";
const TICKETS_HELD = "12 tickets · 0.6 SOL staked";
const NEXT_DRAW_LABEL = "Draws in 04h 21m";
const NEXT_DRAW_DATE = "Jul 3, 2026";
const MEMBER_SINCE = "May 12, 2026";
// External QR mock (decorative). Self-host or generate client-side when
// the real wallet lands.
const QR_SRC = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${WALLET_FULL}`;

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.95, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 30,
      mass: 0.8,
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -15, scale: 0.95, filter: "blur(2px)" },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 400, damping: 28, mass: 0.6 },
  },
};

function CopyRow({
  icon: Icon,
  label,
  value,
  copyText,
}: {
  icon: typeof Copy;
  label: string;
  value: string;
  copyText: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="mb-1 flex items-center gap-1">
          <Icon className="size-3 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </div>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={copy}
        className="ml-2 flex size-6 items-center justify-center rounded-md bg-muted/50 transition-colors hover:bg-muted/80"
      >
        {copied ? (
          <Check className="size-3 text-success" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </motion.button>
    </div>
  );
}

export function DashboardCard() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [mounted, setMounted] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldAnimate = !shouldReduceMotion;

  if (!mounted) {
    return (
      <div className="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-6">
        <div className="flex h-96 items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="mx-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-card"
      initial={shouldAnimate ? "hidden" : "visible"}
      animate="visible"
      variants={shouldAnimate ? containerVariants : {}}
    >
      <div className="relative">
        {/* Main content — dimmed/blurred while the confirm overlay is up. */}
        <motion.div
          initial={false}
          animate={{
            opacity: showConfirm ? 0.3 : 1,
            scale: showConfirm ? 0.95 : 1,
            filter: showConfirm ? "blur(1px)" : "blur(0px)",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
          className="space-y-4 p-6"
        >
          {/* Header: avatar + live badge + QR */}
          <motion.div
            className="flex items-start justify-between"
            variants={shouldAnimate ? itemVariants : {}}
          >
            <div className="flex items-center gap-3">
              <Avatar className="size-12 ring-2 ring-primary/20">
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                  7x
                </AvatarFallback>
              </Avatar>
              <div>
                <Badge variant="secondary" className="mb-1 text-xs font-medium">
                  {NEXT_DRAW_LABEL}
                </Badge>
                <p className="text-sm text-muted-foreground">{NEXT_DRAW_DATE}</p>
              </div>
            </div>
            <div className="size-12 overflow-hidden rounded-lg border border-border/50 bg-muted/50 p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={QR_SRC}
                alt="Wallet QR code"
                className="size-full rounded object-cover"
              />
            </div>
          </motion.div>

          {/* Wallet information */}
          <motion.div
            className="space-y-3"
            variants={shouldAnimate ? itemVariants : {}}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1 flex items-center gap-1">
                  <User className="size-3 text-muted-foreground" />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Wallet
                  </span>
                </div>
                <p className="font-mono text-sm font-medium text-foreground">
                  {WALLET_SHORT}
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1">
                  <Calendar className="size-3 text-muted-foreground" />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Playing since
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground">{MEMBER_SINCE}</p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1">
                <Globe className="size-3 text-muted-foreground" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Network
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">Solana Devnet</p>
            </div>

            <CopyRow
              icon={CreditCard}
              label="Wallet address"
              value={WALLET_SHORT}
              copyText={WALLET_FULL}
            />
            <CopyRow
              icon={Ticket}
              label="Latest ticket"
              value={LATEST_TICKET}
              copyText={LATEST_TICKET}
            />
          </motion.div>

          <motion.div variants={shouldAnimate ? itemVariants : {}}>
            <Separator className="my-4" />
          </motion.div>

          {/* Entry details */}
          <motion.div
            className="space-y-3"
            variants={shouldAnimate ? itemVariants : {}}
          >
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Shield className="size-3 text-muted-foreground" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active vault
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">{ACTIVE_VAULT}</p>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1">
                <Ticket className="size-3 text-muted-foreground" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Your entries
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">{TICKETS_HELD}</p>
            </div>
          </motion.div>

          {/* Action */}
          <motion.div className="pt-4" variants={shouldAnimate ? itemVariants : {}}>
            <motion.div
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <Button
                onClick={() => setShowConfirm(true)}
                variant="outline"
                className="flex w-full items-center justify-center gap-2"
              >
                <Ticket className="size-4" />
                Buy more tickets
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* In-card confirm overlay */}
        <AnimatePresence>
          {showConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0, y: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
                className="relative mx-6 rounded-xl border border-border bg-card p-6 shadow-lg"
              >
                <button
                  onClick={() => setShowConfirm(false)}
                  className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-muted/50 transition-colors hover:bg-muted/70"
                >
                  <X className="size-3 text-muted-foreground" />
                </button>

                <div className="space-y-4 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                    <Ticket className="size-6 text-primary" />
                  </div>

                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-foreground">
                      Buy more tickets
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Confirm a new entry for {WALLET_SHORT}
                    </p>
                  </div>

                  <div className="rounded-lg bg-muted/30 p-3 text-left">
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      Vault
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      {ACTIVE_VAULT}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={() => setShowConfirm(false)}
                      variant="outline"
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <motion.div
                      className="flex-1"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* Mock: the real buy flow is wired in 10.17. */}
                      <Button
                        onClick={() => setShowConfirm(false)}
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        Confirm
                      </Button>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

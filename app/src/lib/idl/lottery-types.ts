/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lottery.json`.
 */
export type Lottery = {
  "address": "DD5CPAQWUtKSBajtNT9w4QbJysQnuWeDZ6yCdXKAYwro",
  "metadata": {
    "name": "lottery",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Decentralized on-chain lottery (devnet MVP) — Anchor program"
  },
  "instructions": [
    {
      "name": "buyTicket",
      "discriminator": [
        11,
        24,
        17,
        193,
        168,
        116,
        164,
        169
      ],
      "accounts": [
        {
          "name": "lottery",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              },
              {
                "kind": "account",
                "path": "lottery.total_tickets",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "drawWinner",
      "discriminator": [
        250,
        103,
        118,
        147,
        219,
        235,
        169,
        220
      ],
      "accounts": [
        {
          "name": "lottery",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "lottery"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initializeLottery",
      "discriminator": [
        113,
        199,
        243,
        247,
        73,
        217,
        33,
        11
      ],
      "accounts": [
        {
          "name": "lottery",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "roundId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "roundId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "roundId",
          "type": "u64"
        },
        {
          "name": "ticketPrice",
          "type": "u64"
        },
        {
          "name": "duration",
          "type": "i64"
        }
      ]
    },
    {
      "name": "payout",
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "lottery",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              }
            ]
          }
        },
        {
          "name": "ticket",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lottery.round_id",
                "account": "lottery"
              },
              {
                "kind": "account",
                "path": "ticket.index",
                "account": "ticket"
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "ping",
      "discriminator": [
        173,
        0,
        94,
        236,
        73,
        133,
        225,
        153
      ],
      "accounts": [],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "lottery",
      "discriminator": [
        162,
        182,
        26,
        12,
        164,
        214,
        112,
        3
      ]
    },
    {
      "name": "ticket",
      "discriminator": [
        41,
        228,
        24,
        165,
        78,
        90,
        235,
        200
      ]
    }
  ],
  "events": [
    {
      "name": "lotteryInitialized",
      "discriminator": [
        198,
        188,
        153,
        94,
        232,
        47,
        124,
        219
      ]
    },
    {
      "name": "prizeClaimed",
      "discriminator": [
        213,
        150,
        192,
        76,
        199,
        33,
        212,
        38
      ]
    },
    {
      "name": "ticketBought",
      "discriminator": [
        80,
        244,
        35,
        181,
        211,
        143,
        3,
        166
      ]
    },
    {
      "name": "winnerDrawn",
      "discriminator": [
        213,
        103,
        5,
        118,
        145,
        75,
        146,
        120
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidDuration",
      "msg": "Duration must be strictly positive."
    },
    {
      "code": 6001,
      "name": "invalidTicketPrice",
      "msg": "Ticket price must be strictly positive."
    },
    {
      "code": 6002,
      "name": "lotteryNotOpen",
      "msg": "The lottery is not open for ticket sales."
    },
    {
      "code": 6003,
      "name": "salesEnded",
      "msg": "Ticket sales have ended for this round."
    },
    {
      "code": 6004,
      "name": "tooEarlyToDraw",
      "msg": "Too early to draw: the round has not ended yet."
    },
    {
      "code": 6005,
      "name": "lotteryNotClosed",
      "msg": "The lottery is not closed yet."
    },
    {
      "code": 6006,
      "name": "noWinner",
      "msg": "There is no winner to pay out for this round."
    },
    {
      "code": 6007,
      "name": "notTheWinner",
      "msg": "Signer is not the winner of this round."
    },
    {
      "code": 6008,
      "name": "alreadyClaimed",
      "msg": "The prize has already been claimed."
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6010,
      "name": "unauthorized",
      "msg": "Signer is not the authority of this round."
    }
  ],
  "types": [
    {
      "name": "lottery",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ticketPrice",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u64"
          },
          {
            "name": "potAmount",
            "type": "u64"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "lotteryState"
              }
            }
          },
          {
            "name": "winnerIndex",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lotteryInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ticketPrice",
            "type": "u64"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lotteryState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "drawing"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "prizeClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ticket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ticketBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "winnerDrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "winnerIndex",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    }
  ]
};

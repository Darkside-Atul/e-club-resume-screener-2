import type { NextConfig } from "next";

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const supabaseUrlCandidate =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_RESUME_MRTS_SUPABASE_URL ||
  process.env.RESUME_MRTS_SUPABASE_URL ||
  process.env.RESUME_MRTS_SUPABASE_URL_2 ||
  process.env.SUPABASE_URL_2 ||
  process.env.SUPABASE_URL_3;
const supabaseUrl = isHttpUrl(supabaseUrlCandidate) ? supabaseUrlCandidate : undefined;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_RESUME_MRTS_SUPABASE_PUBLISHABLE_KEY ||
  process.env.RESUME_MRTS_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY_2 ||
  process.env.SUPABASE_PUBLISHABLE_KEY_3;

const config: NextConfig = {
  ...(supabaseUrl && supabasePublishableKey
    ? {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
        },
      }
    : {}),
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/uploads/submit": [
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-arm64-gnu/**/*"
    ],
    "/api/internal/screen": [
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-arm64-gnu/**/*"
    ]
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" }
      ],
    }];
  }
};

export default config;

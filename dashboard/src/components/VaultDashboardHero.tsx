import { motion } from "framer-motion";
import { useNear } from "../providers/NearProvider.js";
import { config, shorten, type VaultSummary } from "../lib/vault.js";

interface VaultDashboardHeroProps {
  summary: VaultSummary | null;
  onGetStarted?: () => void;
}

export function VaultDashboardHero({ summary, onGetStarted }: VaultDashboardHeroProps) {
  const { accountId, connecting, connect, disconnect } = useNear();

  const handleScroll = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleStart = () => {
    if (onGetStarted) {
      onGetStarted();
    } else {
      handleScroll("vault-dashboard");
    }
  };

  const hasPendingMove = summary?.pending_move !== null && summary?.pending_move !== undefined;
  const isAgentActive = summary?.agent_enabled && !summary?.paused;

  return (
    <section className="relative min-h-[90vh] bg-[#0A0B0E] text-white flex flex-col justify-between overflow-hidden px-6 md:px-16 py-8 rounded-2xl border border-white/5 mb-8 shadow-2xl">
      {/* Background Neon Glowing Gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-[350px] h-[350px] bg-cyan-500/12 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[300px] h-[300px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Navbar */}
      <header className="flex items-center justify-between z-10 w-full pb-6 border-b border-white/5">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-cyan-400 flex items-center justify-center font-bold text-lg shadow-lg shadow-purple-500/30 text-white">
            VP
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
              VaultPilot
            </span>
            <span className="text-[10px] text-cyan-400 font-mono tracking-wider uppercase">
              NEAR Intents Autonomous Vault
            </span>
          </div>
        </div>

        <nav className="hidden md:flex items-center space-x-8 text-sm text-gray-400 font-medium">
          <button
            onClick={() => handleScroll("vault-dashboard")}
            className="hover:text-white transition-colors cursor-pointer bg-transparent border-0 p-0"
          >
            Vaults
          </button>
          <button
            onClick={() => handleScroll("intent-tracker")}
            className="hover:text-white transition-colors cursor-pointer bg-transparent border-0 p-0"
          >
            Intents
          </button>
          <button
            onClick={() => handleScroll("quote-simulator")}
            className="hover:text-white transition-colors cursor-pointer bg-transparent border-0 p-0"
          >
            Simulator
          </button>
          <button
            onClick={() => handleScroll("rebalance-history")}
            className="hover:text-white transition-colors cursor-pointer bg-transparent border-0 p-0"
          >
            History
          </button>
        </nav>

        <div className="flex items-center space-x-3">
          <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full text-xs font-mono bg-white/5 border border-white/10 text-gray-300">
            {config.network}
          </span>
          {accountId ? (
            <div className="flex items-center space-x-2">
              <span className="px-3 py-1.5 rounded-xl bg-white/5 border border-purple-400/30 text-xs font-mono text-purple-300">
                {shorten(accountId, 10, 6)}
              </span>
              <button
                onClick={() => void disconnect().catch(() => undefined)}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-400 hover:text-white transition-all border border-white/10 cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => void connect().catch(() => undefined)}
              disabled={connecting}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium text-sm shadow-lg shadow-purple-600/25 border border-purple-400/20 backdrop-blur-md cursor-pointer"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </motion.button>
          )}
        </div>
      </header>

      {/* Hero Body Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center my-auto z-10 py-10">
        {/* Left Column: Text & CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="lg:col-span-7 space-y-6"
        >
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-purple-300 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-medium">Powered by NEAR Intents &amp; Scoped Function-Call Keys</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.12]">
            Simplifying DeFi's Most <br />
            <span className="bg-gradient-to-r from-purple-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent">
              Complex Transactions
            </span>
          </h1>

          <p className="text-gray-400 text-base sm:text-lg max-w-xl font-normal leading-relaxed">
            Execute cross-chain yield strategies effortlessly with intent-powered automated routing,
            secure bounded keys, and on-chain policy enforcement where markets never close.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleStart}
              className="px-7 py-3.5 rounded-xl bg-white text-black font-semibold text-sm shadow-xl hover:bg-gray-100 transition-all flex items-center space-x-2 cursor-pointer"
            >
              <span>Get started</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </motion.button>

            <button
              onClick={() => handleScroll("quote-simulator")}
              className="px-6 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-sm backdrop-blur-md transition-all cursor-pointer"
            >
              Test 1Click Simulator
            </button>
          </div>

          {/* Key Trust & Architecture Pillars */}
          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/5 max-w-lg">
            <div>
              <p className="text-xs text-gray-500 uppercase font-mono">Key Security</p>
              <p className="text-sm font-semibold text-white mt-1">Bounded Agent</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-mono">Routing</p>
              <p className="text-sm font-semibold text-cyan-400 mt-1">1Click Intents</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-mono">Accounting</p>
              <p className="text-sm font-semibold text-purple-300 mt-1">ERC-4626 Math</p>
            </div>
          </div>
        </motion.div>

        {/* Right Column: 3D Holographic Portal Graphic / Glass Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="lg:col-span-5 relative flex items-center justify-center"
        >
          {/* Glowing ring container */}
          <div className="relative w-full max-w-[420px] aspect-square rounded-3xl bg-gradient-to-b from-white/10 to-transparent p-[1px] backdrop-blur-2xl shadow-2xl shadow-purple-900/30">
            <div className="w-full h-full rounded-3xl bg-[#0F1015]/90 p-6 flex flex-col justify-between relative overflow-hidden">
              {/* Internal ambient lights */}
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-purple-600/25 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-cyan-600/20 rounded-full blur-3xl pointer-events-none" />

              {/* Top card stats */}
              <div className="flex justify-between items-center z-10 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs text-gray-400 font-medium">Active Yield Router</p>
                  <p className="text-sm font-bold text-cyan-400 font-mono">
                    {hasPendingMove ? "Cross-Chain Move In-Flight" : "1Click Solver Stream"}
                  </p>
                </div>
                <div
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    hasPendingMove
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : isAgentActive
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-gray-500/10 border-gray-500/20 text-gray-400"
                  }`}
                >
                  {hasPendingMove ? "Routing" : isAgentActive ? "Active" : "Standby"}
                </div>
              </div>

              {/* Center Holographic Graphic Representation */}
              <div className="my-auto py-6 flex flex-col items-center justify-center relative z-10">
                <div className="w-36 h-36 rounded-full border border-purple-500/30 flex items-center justify-center relative animate-[spin_20s_linear_infinite]">
                  <div className="absolute inset-2 rounded-full border border-cyan-400/25 border-dashed animate-[spin_15s_linear_infinite_reverse]" />
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-purple-600/70 to-cyan-400/70 blur-md absolute" />
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-500 to-cyan-300 shadow-xl shadow-cyan-500/40 flex items-center justify-center font-extrabold text-xl text-black z-10">
                    VP
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-4 tracking-wider uppercase font-mono">
                  {hasPendingMove ? "Intent Solver Executing" : "Autonomous Market Watcher"}
                </p>
              </div>

              {/* Bottom stats pill */}
              <div className="z-10 bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center justify-between backdrop-blur-md">
                <div>
                  <span className="text-xs text-gray-400">Target External Yield</span>
                  <p className="text-lg font-bold text-white">
                    12.0% <span className="text-xs font-normal text-emerald-400">+7.5% spread</span>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-400">Scoped Key</span>
                  <p className="text-xs font-mono text-purple-300 font-semibold">
                    {summary?.agent_enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer minimal info */}
      <footer className="flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 border-t border-white/5 pt-6 z-10">
        <p>&copy; 2026 VaultPilot Protocol &bull; Built for NEAR Hackathon</p>
        <div className="flex space-x-6 mt-3 sm:mt-0 font-medium">
          <button
            onClick={() => handleScroll("wiring-section")}
            className="hover:text-gray-400 cursor-pointer bg-transparent border-0 p-0"
          >
            Wiring &amp; Architecture
          </button>
          <button
            onClick={() => handleScroll("policy-section")}
            className="hover:text-gray-400 cursor-pointer bg-transparent border-0 p-0"
          >
            Policy Guardrails
          </button>
        </div>
      </footer>
    </section>
  );
}

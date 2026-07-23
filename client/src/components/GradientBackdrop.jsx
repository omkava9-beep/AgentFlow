// Fixed, low-opacity blurred color blobs behind the whole app — gives the UI
// an "AI product" ambient feel without interfering with content or contrast.
export default function GradientBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl dark:bg-brand-600/20" />
      <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-purple-400/20 blur-3xl dark:bg-purple-700/20" />
      <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-700/15" />
    </div>
  );
}

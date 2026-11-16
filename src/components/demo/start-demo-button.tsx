import { startDemoAction } from "@/app/demo-actions";

/** "Start the demo": a form post, so a visit alone creates nothing. Free of Yjs. */
export function StartDemoButton({ label = "Start the demo" }: { label?: string }) {
  return (
    <form action={startDemoAction}>
      <button
        type="submit"
        className="h-10 rounded-sm bg-indigo px-4 text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
      >
        {label}
      </button>
    </form>
  );
}

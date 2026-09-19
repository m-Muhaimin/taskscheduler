import type { ReactNode } from "react";

interface SubmitButtonProps {
  loading: boolean;
  children: ReactNode;
  loadingLabel: string;
}

export function SubmitButton({ loading, children, loadingLabel }: SubmitButtonProps) {
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={loading} aria-busy={loading}>
      {loading && (
        <span
          aria-hidden="true"
          className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      {loading ? loadingLabel : children}
    </button>
  );
}

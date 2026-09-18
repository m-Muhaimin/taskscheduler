import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FooterProps extends React.HTMLAttributes<HTMLDivElement> {
  links?: { label: string; href: string }[];
}

export default function Footer({ links = [], className, ...props }: FooterProps) {
  return (
    <footer className={cn("border-t bg-muted/30 py-10", className)} {...props}>
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">S</span>
            <span className="font-medium">TradeScheduler</span>
            <span className="mx-2 text-muted-foreground/50">·</span>
            <span>© 2026 TradeScheduler. All rights reserved.</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 justify-center md:justify-start">
            {links.length === 0 ? (
              <>
                <Link href="/login" className="hover:text-foreground transition-colors">Log in</Link>
                <Link href="/register" className="hover:text-foreground transition-colors">Get Started</Link>
                <Link href="/demo/chart" className="hover:text-foreground transition-colors">Demo</Link>
              </>
            ) : (
              links.map((l) => (
                <Link key={l.label} href={l.href} className="hover:text-foreground transition-colors">
                  {l.label}
                </Link>
              ))
            )}
          </nav>
        </div>
      </div>
    </footer>
  );
}

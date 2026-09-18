import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";

interface FAQItemProps {
  question: string;
  answer: string;
}

export default function FAQ({ items, className, ...props }: { items: FAQItemProps[]; className?: string }) {
  return (
    <section className={cn("space-y-12", className)} {...props}>
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-heading font-bold tracking-tight">Frequently asked questions</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Everything you need to know before getting started.
        </p>
      </div>
      <Accordion.Root type="single" collapsible defaultValue="item-1" className="w-full max-w-2xl mx-auto space-y-2">
        {items.map((item, idx) => (
          <FAQItem key={idx} question={item.question} answer={item.answer} idx={idx} />
        ))}
      </Accordion.Root>
    </section>
  );
}

function FAQItem({ question, answer, idx }: FAQItemProps & { idx: number }) {
  const value = `item-${idx + 1}`;
  return (
    <Accordion.Item value={value} className="border-b">
      <Accordion.Header>
        <Accordion.Trigger className="flex w-full items-center justify-between py-4 text-left text-sm font-semibold [&[data-state=open]>svg]:rotate-180">
          {question}
          <ChevronDown className="ml-4 h-4 w-4 text-muted-foreground transition-transform" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-up-4 data-[state=open]:slide-in-down-4 overflow-hidden text-sm text-muted-foreground leading-relaxed">
        <div className="pb-4">{answer}</div>
      </Accordion.Content>
    </Accordion.Item>
  );
}

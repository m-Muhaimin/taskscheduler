import os
content = """
import Hero from "@/components/marketing/Hero";
import FeatureCard from "@/components/marketing/FeatureCard";
import Step from "@/components/marketing/Step";
import PricingCard from "@/components/marketing/PricingCard";
import CTASection from "@/components/marketing/CTASection";
import FAQItem from "@/components/marketing/FAQItem";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Hero />

      <section className="py-24 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-urgent border-urgent font-medium">The Problem</Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">Every missed call is a job that went to someone else.</h2>

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ClassModeOnboardingGuideProps {
  clubId: string;
}

export function ClassModeOnboardingGuide({ clubId }: ClassModeOnboardingGuideProps) {
  // Check terms
  const { data: terms = [] } = useQuery({
    queryKey: ["terms", clubId, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("id")
        .eq("club_id", clubId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Check classes
  const { data: classes = [] } = useQuery({
    queryKey: ["club-classes", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId)
        .not("class_day", "is", null);
      if (error) throw error;
      return data;
    },
  });

  // Check enrolments
  const { data: enrolments = [] } = useQuery({
    queryKey: ["onboarding-enrolments", clubId],
    queryFn: async () => {
      if (terms.length === 0) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("id")
        .eq("term_id", terms[0].id)
        .eq("status", "enrolled")
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: terms.length > 0,
  });

  const hasTerms = terms.length > 0;
  const hasClasses = classes.length > 0;
  const hasEnrolments = enrolments.length > 0;

  // Don't show if all steps complete
  if (hasTerms && hasClasses && hasEnrolments) return null;

  const steps = [
    {
      label: "Create a Term",
      description: "Set up a scheduling block (e.g. Term 1, Summer Session)",
      done: hasTerms,
      action: null, // Terms are managed in the accordion below
    },
    {
      label: "Add Classes",
      description: "Create class slots with day, time and capacity",
      done: hasClasses,
      link: `/clubs/${clubId}/teams/new`,
    },
    {
      label: "Open Enrolments",
      description: "Share the enrolment link with parents and members",
      done: hasEnrolments,
      link: `/clubs/${clubId}/enrol`,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Getting Started</h3>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{steps.length} complete
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-2 rounded-lg ${
                step.done ? "opacity-60" : ""
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    step.done ? "line-through" : ""
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {step.description}
                </p>
              </div>
              {!step.done && step.link && (
                <Link to={step.link}>
                  <Button variant="ghost" size="sm" className="shrink-0 h-7 gap-1">
                    Go <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

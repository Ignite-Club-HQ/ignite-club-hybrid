import { type ReactNode, type RefObject, useState } from "react";
import { AlertCircle, ChevronDown, Download, FileText, Info, Upload, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export interface CsvImportIssue {
  row: number;
  message: string;
}

interface CsvImportDialogFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}

export function CsvImportDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  children,
}: CsvImportDialogFrameProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent fullScreen className="sm:max-w-md max-h-[90vh] flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {title}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {children}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface CsvFormatGuideProps {
  columns: readonly string[];
  children: ReactNode;
  onDownloadTemplate: () => void;
}

export function CsvFormatGuide({ columns, children, onDownloadTemplate }: CsvFormatGuideProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between h-10">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span className="text-sm">CSV format guide</span>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((column, index) => (
                    <Badge key={column} variant={index === 0 ? "default" : "secondary"} className="text-xs">
                      {column}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">{children}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={onDownloadTemplate}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download template
            </Button>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface CsvFileDropZoneProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  contentClassName: string;
}

export function CsvFileDropZone({ fileInputRef, onFile, contentClassName }: CsvFileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="text/csv,.csv"
        onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          onFile(file);
          event.target.value = "";
        }}
        className="hidden"
      />
      <Card
        className={`border-2 border-dashed transition-all cursor-pointer ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragEnter={event => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={event => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(false);
        }}
        onDragOver={event => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={event => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <CardContent className={contentClassName}>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={`rounded-full p-3 transition-colors ${isDragging ? "bg-primary/10" : "bg-muted"}`}>
              <Upload className={`h-6 w-6 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className="font-medium text-sm">{isDragging ? "Drop file here" : "Tap to upload CSV"}</p>
              <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
            </div>
            <Badge variant="secondary">.csv</Badge>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

interface CsvTemplateDownloadButtonProps {
  onClick: () => void;
}

export function CsvTemplateDownloadButton({ onClick }: CsvTemplateDownloadButtonProps) {
  return (
    <Button variant="outline" className="w-full" onClick={onClick}>
      <Download className="h-4 w-4 mr-2" />
      Download CSV Template
    </Button>
  );
}

interface CsvImportedFileProps {
  fileName: string;
  onClear: () => void;
}

export function CsvImportedFile({ fileName, onClear }: CsvImportedFileProps) {
  return (
    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium truncate">{fileName}</span>
      </div>
      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface CsvIssueSummaryProps {
  issues: readonly CsvImportIssue[];
  listClassName: string;
  additionalIssuesLabel: (count: number) => string;
  additionalIssuesClassName?: string;
}

export function CsvIssueSummary({
  issues,
  listClassName,
  additionalIssuesLabel,
  additionalIssuesClassName,
}: CsvIssueSummaryProps) {
  if (issues.length === 0) return null;

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <ul className={listClassName}>
          {issues.slice(0, 3).map((issue, index) => (
            <li key={`${issue.row}-${issue.message}-${index}`}>
              {issue.row > 0 ? `Row ${issue.row}: ` : ""}{issue.message}
            </li>
          ))}
          {issues.length > 3 && <li className={additionalIssuesClassName}>{additionalIssuesLabel(issues.length - 3)}</li>}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

interface CsvPreviewShellProps {
  containerClassName: string;
  header: ReactNode;
  scrollAreaClassName: string;
  contentClassName: string;
  children: ReactNode;
}

export function CsvPreviewShell({
  containerClassName,
  header,
  scrollAreaClassName,
  contentClassName,
  children,
}: CsvPreviewShellProps) {
  return (
    <div className={containerClassName}>
      {header}
      <ScrollArea className={scrollAreaClassName}>
        <div className={contentClassName}>{children}</div>
      </ScrollArea>
    </div>
  );
}

export function downloadCsvTemplate(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

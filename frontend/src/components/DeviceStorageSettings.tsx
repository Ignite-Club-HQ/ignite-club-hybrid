import { useState } from 'react';
import { HardDrive, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearDownloadedContent } from '@/lib/clearDownloadedContent';

export function DeviceStorageSettings() {
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState('');
  async function clear() {
    setClearing(true); setResult('');
    try {
      await clearDownloadedContent();
      setResult('Downloaded copies cleared. Your account and original content are unchanged.');
    } catch {
      setResult('Some downloaded copies could not be cleared. Please try again.');
    } finally { setClearing(false); }
  }
  return <section aria-labelledby="device-storage-title" className="space-y-3 border-t pt-5">
    <h2 id="device-storage-title" className="flex items-center gap-2 font-semibold">
      <HardDrive className="h-5 w-5" /> Device storage
    </h2>
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-3"><dt>Saved page and message copies</dt><dd className="shrink-0">4 MB limit</dd></div>
      <div className="flex justify-between gap-3"><dt>Saved viewed-photo copies</dt><dd className="shrink-0">20 MB limit</dd></div>
    </dl>
    <Button variant="outline" onClick={clear} disabled={clearing} className="w-full sm:w-auto whitespace-normal">
      {clearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
      Clear downloaded content
    </Button>
    {result && <p role="status" className="text-sm text-muted-foreground">{result}</p>}
  </section>;
}
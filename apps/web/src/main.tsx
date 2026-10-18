import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, CheckCircle2, CircleAlert, Layers3, Leaf, LoaderCircle, RefreshCw } from 'lucide-react';
import { healthResponseSchema, type Health } from '@learnspace/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import './styles.css';

type Connection = { state: 'loading' } | { state: 'ready'; health: Health } | { state: 'error'; message: string };
function Dashboard() {
  const [connection, setConnection] = useState<Connection>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal, headers: { Accept: 'application/json' } });
        const result = healthResponseSchema.parse(await response.json());
        if (!response.ok || result.data.status !== 'ok') throw new Error('The local database or storage is unavailable. Check the API and PostgreSQL, then try again.');
        setConnection({ state: 'ready', health: result.data });
      } catch (error) {
        if (!controller.signal.aborted) setConnection({ state: 'error', message: error instanceof Error && error.message.startsWith('The local') ? error.message : 'Could not connect to LearnSpace. Start the local API and try again.' });
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt]);
  const retry = () => { setConnection({ state: 'loading' }); setAttempt(value => value + 1); };
  return <>
    <div className="mb-10 flex flex-wrap items-start justify-between gap-5">
      <div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Your learning space</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Room to follow your curiosity.</h1><p className="mt-3 max-w-xl text-muted-foreground">A personal place to build understanding, one concept at a time.</p></div>
      <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Foundation preview</span>
    </div>
    <section aria-label="Workspace connection" aria-live="polite" className="mb-8">
      {connection.state === 'loading' && <Card className="flex items-center gap-3 p-5"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /><p role="status">Connecting to your local workspace…</p></Card>}
      {connection.state === 'error' && <Card className="border-amber-300 bg-amber-50 p-5"><div className="flex items-start gap-3"><CircleAlert className="size-5 shrink-0 text-amber-800" aria-hidden="true" /><div><p className="font-medium">Workspace needs attention</p><p className="mt-1 text-sm text-muted-foreground" role="alert">{connection.message}</p><Button variant="outline" size="sm" className="mt-4" onClick={retry}><RefreshCw className="size-4" aria-hidden="true" />Try again</Button></div></div></Card>}
      {connection.state === 'ready' && <Card className="flex items-center gap-3 p-5"><CheckCircle2 className="size-5 text-primary" aria-hidden="true" /><div><p className="text-sm font-medium">Your local workspace is connected</p><p className="mt-0.5 text-xs text-muted-foreground">PostgreSQL and local storage are ready.</p></div></Card>}
    </section>
    <section aria-labelledby="courses-heading">
      <div className="mb-4 flex items-center justify-between"><h2 id="courses-heading" className="text-lg font-semibold">Your courses</h2><span className="text-xs text-muted-foreground">A fresh start</span></div>
      <Card className="flex min-h-72 flex-col items-center justify-center border-dashed px-6 py-12 text-center"><div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted"><BookOpen className="size-6 text-primary" aria-hidden="true" /></div><h3 className="text-xl font-medium">What will you learn next?</h3><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Course creation and your learning library are coming in the next milestone. For now, your workspace foundation is taking shape.</p></Card>
    </section>
    <div className="mt-8 grid gap-4 sm:grid-cols-2"><Card className="p-6"><Leaf className="mb-4 size-5 text-primary" aria-hidden="true" /><h3 className="font-medium">Your notes, your knowledge</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Designed around learning materials you can shape and keep on your own machine.</p></Card><Card className="p-6"><Layers3 className="mb-4 size-5 text-primary" aria-hidden="true" /><h3 className="font-medium">A path through the details</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Future courses will organize big goals into small, connected learning units.</p></Card></div>
  </>;
}

function App() {
  return <BrowserRouter><a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-10 focus:bg-card focus:p-4">Skip to content</a><div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
    <aside className="border-b border-border bg-card px-6 py-5 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 lg:py-8"><Link to="/" className="flex items-center gap-3 font-semibold"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BookOpen className="size-5" aria-hidden="true" /></span><span>LearnSpace <span className="font-normal text-muted-foreground">AI</span></span></Link><nav aria-label="Main navigation" className="mt-6"><NavLink to="/" className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm font-medium text-primary"><Layers3 className="size-4" aria-hidden="true" />My learning</NavLink></nav><p className="mt-6 hidden text-xs leading-5 text-muted-foreground lg:block">A little understanding,<br />every day.</p></aside>
    <main id="main" className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-10 lg:py-14"><Routes><Route path="/" element={<Dashboard />} /><Route path="*" element={<div><h1 className="text-2xl font-semibold">This page isn’t here yet.</h1><Button asChild className="mt-5"><Link to="/">Return to your workspace<ArrowUpRight className="size-4" /></Link></Button></div>} /></Routes></main>
  </div></BrowserRouter>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><App /></StrictMode>);

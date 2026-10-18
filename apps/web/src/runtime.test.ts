import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Slot } from '@radix-ui/react-slot';
import { describe, expect, it } from 'vitest';

describe('frontend React runtime integration', () => {
  it('renders routing and UI dependencies with the app renderer', () => {
    const html = renderToString(createElement(MemoryRouter, null,
      createElement(Routes, null,
        createElement(Route, { path: '/', element: createElement(Slot, null,
          createElement(Link, { to: '/course' }, 'Open your learning space')) }))));
    expect(html).toContain('Open your learning space');
    expect(html).toContain('href="/course"');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { Header } from '../Header.js';

describe('Header', () => {
  it('shows projectRoot in the badge', () => {
    render(
      <MockHmiProvider projectRoot="Narya1">
        <Header />
      </MockHmiProvider>,
    );
    expect(screen.getByText(/Narya1/)).toBeTruthy();
  });

  it('falls back to a placeholder when projectRoot is null', () => {
    render(
      <MockHmiProvider projectRoot={null}>
        <Header />
      </MockHmiProvider>,
    );
    expect(screen.getByText(/No system configured/)).toBeTruthy();
  });
});

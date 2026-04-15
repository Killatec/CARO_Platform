import { useState, useRef, useEffect } from 'react';
import type React from 'react';
import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { resolveFormat } from './utils.js';
import { useWriteGuard } from './useWriteGuard.js';

export interface UseNumericInputOptions {
  /** Called whenever writeError changes. Use for error bubbling in composite widgets. */
  onError?: (msg: string | null) => void;
}

export interface UseNumericInputResult {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  placeholder: string;
  isFocused: boolean;
  isWriting: boolean;
  badQuality: boolean;
  writeError: string | null;
  handleFocus: () => void;
  handleBlur: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useNumericInput(
  tag: TagDef,
  options?: UseNumericInputOptions,
): UseNumericInputResult {
  const lv = useLiveValue(tag.tag_id);
  const { write, error } = useTagWriter();
  const fmt = resolveFormat(tag);
  const writeError = error(tag.tag_id);
  const { setAwaitedValue, isWriting } = useWriteGuard(tag.tag_id, lv.value, writeError);

  const badQuality = lv.value === null;
  const isFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const formattedLive = lv.value !== null ? fmt(lv.value as number) : '---';
  const [inputValue, setInputValue] = useState<string>(formattedLive);
  const [placeholder, setPlaceholder] = useState('');

  // When live value changes: update placeholder if editing, or inputValue if idle.
  useEffect(() => {
    if (isFocusedRef.current) {
      setPlaceholder(formattedLive);
    } else {
      setInputValue(formattedLive);
    }
  }, [formattedLive]);

  // Keep onError ref current so the writeError effect doesn't need it as a dep —
  // the effect only fires when writeError changes, but always calls the latest onError.
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  useEffect(() => {
    onErrorRef.current?.(writeError);
  }, [writeError]);

  function handleFocus() {
    if (badQuality || isWriting) return;
    isFocusedRef.current = true;
    setIsFocused(true);
    setPlaceholder(formattedLive);
    setInputValue('');
  }

  function handleBlur() {
    isFocusedRef.current = false;
    setIsFocused(false);
    setInputValue(formattedLive);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (isWriting) return;
      const trimmed = inputValue.trim();
      const parsed = parseFloat(trimmed);
      if (trimmed === '' || isNaN(parsed)) return;
      setAwaitedValue(parsed);
      void write(tag.tag_id, parsed);
      setPlaceholder(fmt(parsed));
      setInputValue('');
      // Retain focus — operator can immediately type the next value.
    }
    if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
  }

  return {
    inputRef,
    inputValue,
    placeholder,
    isFocused,
    isWriting,
    badQuality,
    writeError,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleChange,
  };
}

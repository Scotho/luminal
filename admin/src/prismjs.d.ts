declare module 'prismjs' {
  const Prism: {
    languages: Record<string, unknown>;
    highlight(code: string, grammar: unknown, language: string): string;
  };
  export default Prism;
}

declare module 'prismjs/components/prism-typescript';
declare module 'prismjs/components/prism-javascript';
declare module 'prismjs/components/prism-json';
declare module 'prismjs/components/prism-css';
declare module 'prismjs/components/prism-bash';
declare module 'prismjs/components/prism-diff';

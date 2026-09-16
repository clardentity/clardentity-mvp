declare module "nspell" {
  type Dictionary = { aff: string | Uint8Array; dic?: string | Uint8Array };
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    dictionary(dic: string | Uint8Array): NSpell;
  }
  export default function nspell(dictionary: Dictionary | Dictionary[]): NSpell;
}

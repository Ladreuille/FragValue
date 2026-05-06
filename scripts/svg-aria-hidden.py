#!/usr/bin/env python3
"""
Ajoute aria-hidden="true" aux SVG inline qui n'ont aucun attribut d'accessibilite
existant (aria-hidden, aria-label, aria-labelledby, role).

Cf. ultrareview a11y : 125+ SVG decoratifs sans aria-hidden dans les 4 pages
principales. Lecteurs ecran les annoncaient comme "image" vide. Fix en batch.

Usage : python3 scripts/svg-aria-hidden.py file1.html file2.html ...
Idempotent : ne touche pas les SVG qui ont deja un attribut a11y.
"""
import re
import sys

# Match `<svg ...>` (l'attrs interne peut etre multi-line, [^>]* matche tout
# sauf le > de fermeture). Capture l'integralite des attributs pour les
# preserver intacts.
SVG_OPEN_RE = re.compile(r'<svg(?P<attrs>[^>]*)>', re.DOTALL)

A11Y_ATTRS = ['aria-hidden', 'aria-label', 'aria-labelledby', 'role=']


def has_a11y_attr(attrs):
    """Retourne True si le SVG a deja un attribut a11y."""
    return any(attr in attrs for attr in A11Y_ATTRS)


def add_aria_hidden(content):
    """Retourne (nouveau_contenu, nb_svg_touches)."""
    counter = {'count': 0}

    def replace(m):
        attrs = m.group('attrs')
        if has_a11y_attr(attrs):
            return m.group(0)  # skip
        counter['count'] += 1
        # Insere aria-hidden="true" juste apres `<svg` avec un espace.
        return f'<svg aria-hidden="true"{attrs}>'

    new_content = SVG_OPEN_RE.sub(replace, content)
    return new_content, counter['count']


def process_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    new_content, count = add_aria_hidden(content)

    if count == 0:
        print(f'  {path} : 0 SVG modifie (deja conforme)')
        return 0

    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f'  {path} : {count} SVG enrichi de aria-hidden="true"')
    return count


def main():
    if len(sys.argv) < 2:
        print('Usage : python3 scripts/svg-aria-hidden.py file1.html file2.html ...')
        sys.exit(1)

    total = 0
    for path in sys.argv[1:]:
        total += process_file(path)

    print(f'\nTotal : {total} SVG enrichis sur {len(sys.argv) - 1} fichiers')


if __name__ == '__main__':
    main()

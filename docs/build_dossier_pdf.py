# -*- coding: utf-8 -*-
"""
Genere docs/fragvalue-dossier-structures.pdf
Dossier B2B paginé : (1) one-pager vente, (2) business plan, (3) cartographie.
Design sobre/pro, accent lime #b8ff57, fond clair. Sans emoji ni tiret cadratin.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether,
)

OUT = "fragvalue-dossier-structures.pdf"

# ── Palette ──
LIME       = colors.HexColor("#8FCB1F")   # lime assombri pour lisibilite sur blanc
LIME_BAR   = colors.HexColor("#b8ff57")   # lime pur pour barres/aplats
INK        = colors.HexColor("#0d0f0f")
GREY       = colors.HexColor("#55605f")
GREY_LIGHT = colors.HexColor("#8a9492")
PANEL      = colors.HexColor("#f4f6f3")
PANEL_LIME = colors.HexColor("#f2fae4")
LINE       = colors.HexColor("#dde2dd")
WHITE      = colors.white

styles = getSampleStyleSheet()

def S(name, **kw):
    base = kw.pop("parent", styles["Normal"])
    return ParagraphStyle(name, parent=base, **kw)

H_OVER  = S("over", fontName="Helvetica-Bold", fontSize=8, textColor=LIME, leading=12,
            spaceAfter=3, tracking=1)
H1      = S("h1", fontName="Helvetica-Bold", fontSize=22, textColor=INK, leading=25, spaceAfter=4)
H2      = S("h2", fontName="Helvetica-Bold", fontSize=15, textColor=INK, leading=19,
            spaceBefore=16, spaceAfter=7)
H3      = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=INK, leading=15,
            spaceBefore=9, spaceAfter=3)
BODY    = S("body", fontName="Helvetica", fontSize=9.7, textColor=INK, leading=14.5,
            alignment=TA_JUSTIFY, spaceAfter=6)
BODY_C  = S("bodyc", parent=BODY, alignment=TA_CENTER)
LEAD    = S("lead", fontName="Helvetica", fontSize=11, textColor=GREY, leading=16,
            alignment=TA_CENTER, spaceAfter=4)
SMALL   = S("small", fontName="Helvetica", fontSize=8, textColor=GREY_LIGHT, leading=11)
QUOTE   = S("quote", fontName="Helvetica-Oblique", fontSize=9.5, textColor=GREY, leading=14,
            leftIndent=10, spaceBefore=4, spaceAfter=4)
CELL    = S("cell", fontName="Helvetica", fontSize=8.3, textColor=INK, leading=11)
CELL_B  = S("cellb", parent=CELL, fontName="Helvetica-Bold")
CELL_H  = S("cellh", fontName="Helvetica-Bold", fontSize=8.3, textColor=WHITE, leading=11)
CELL_LIME = S("celllime", parent=CELL_B, textColor=colors.HexColor("#3f6b00"))

def rule(color=LIME_BAR, w=1.4, space=8):
    return HRFlowable(width="100%", thickness=w, color=color,
                      spaceBefore=space, spaceAfter=space, lineCap="round")

def promise_box(num, title, text):
    inner = [
        Paragraph(num, S("pn", fontName="Helvetica-Bold", fontSize=20, textColor=LIME, leading=22)),
        Paragraph(title, S("pt", fontName="Helvetica-Bold", fontSize=11, textColor=INK, leading=14, spaceBefore=2, spaceAfter=4)),
        Paragraph(text, S("px", fontName="Helvetica", fontSize=8.6, textColor=GREY, leading=12)),
    ]
    t = Table([[inner]], colWidths=[150])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), PANEL),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 12), ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 12), ("BOTTOMPADDING", (0,0), (-1,-1), 14),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    return t

def data_table(rows, header, col_widths, lime_rows=None, lime_col0=False):
    lime_rows = lime_rows or []
    data = [[Paragraph(c, CELL_H) for c in header]]
    for r in rows:
        data.append([Paragraph(c, CELL) for c in r])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    st = [
        ("BACKGROUND", (0,0), (-1,0), INK),
        ("LINEBELOW", (0,0), (-1,-1), 0.4, LINE),
        ("LINEAFTER", (0,0), (-2,-1), 0.4, LINE),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 6), ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, PANEL]),
    ]
    for ri in lime_rows:
        st.append(("BACKGROUND", (0, ri), (-1, ri), PANEL_LIME))
    t.setStyle(TableStyle(st))
    return t

# ── Document avec footer pagine ──
class Dossier(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                         topMargin=18*mm, bottomMargin=16*mm, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin,
                      self.width, self.height, id="main")
        self.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=self._footer)])

    def _footer(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
        canvas.line(20*mm, 12*mm, A4[0]-20*mm, 12*mm)
        canvas.setFont("Helvetica", 7.5); canvas.setFillColor(GREY_LIGHT)
        canvas.drawString(20*mm, 8.5*mm, "FragValue  -  Dossier structures  -  Confidentiel")
        canvas.drawRightString(A4[0]-20*mm, 8.5*mm, "p. %d" % doc.page)
        canvas.restoreState()

story = []

# ════════════════ COUVERTURE ════════════════
story.append(Spacer(1, 120))
story.append(Paragraph("FRAG<font color='#8FCB1F'>VALUE</font>",
             S("logo", fontName="Helvetica-Bold", fontSize=40, textColor=INK, alignment=TA_CENTER, leading=44)))
story.append(Spacer(1, 10))
story.append(Paragraph("DOSSIER STRUCTURES", S("cv", fontName="Helvetica-Bold", fontSize=15, textColor=LIME, alignment=TA_CENTER, leading=20)))
story.append(Spacer(1, 6))
story.append(Paragraph("L'analyste que ton equipe ne peut pas se payer.",
             S("cvs", fontName="Helvetica-Oblique", fontSize=13, textColor=GREY, alignment=TA_CENTER, leading=18)))
story.append(Spacer(1, 24))
story.append(HRFlowable(width=60*mm, thickness=2, color=LIME_BAR, spaceBefore=0, spaceAfter=0, hAlign="CENTER"))
story.append(Spacer(1, 24))
story.append(Paragraph("Solution B2B pour structures esport CS2<br/>Orgs, academies, ecoles de formation",
             S("cvd", fontName="Helvetica", fontSize=10, textColor=GREY, alignment=TA_CENTER, leading=16)))
story.append(Spacer(1, 140))
story.append(Paragraph("Juin 2026  -  fragvalue.com  -  contact@fragvalue.com",
             S("cvf", fontName="Helvetica", fontSize=8.5, textColor=GREY_LIGHT, alignment=TA_CENTER)))
story.append(PageBreak())

# ════════════════ PARTIE 1 : ONE-PAGER VENTE ════════════════
story.append(Paragraph("PARTIE 1", H_OVER))
story.append(Paragraph("One-pager de vente", H1))
story.append(rule())
story.append(Spacer(1, 4))

story.append(Paragraph("Le constat", H2))
story.append(Paragraph(
    "Preparer un adversaire, c'est regarder ses demos, reperer ses tendances et monter "
    "l'anti-strat. Une structure tier 1 paie un analyste dedie pour ca. En dessous, c'est "
    "le coach qui le fait en plus du reste, ou personne. Le travail d'analyste existe "
    "partout dans le jeu competitif ; le poste, lui, est un luxe reserve au sommet.", BODY))
story.append(Paragraph(
    "\"You're going to spend more time studying the game and other teams than watching "
    "your own team.\"", QUOTE))
story.append(Paragraph("sheddaN, analyste professionnel CS", SMALL))

story.append(Paragraph("Trois charges en moins", H2))
promises = [
    ("01", "Ton analyste, sans le salaire",
     "Demos adverses analysees, patterns par map, anti-strat pret a l'emploi. Ton coach "
     "arrive en strat time avec le plan, pas avec 4h de VOD a se taper."),
    ("02", "La charge du coach en moins",
     "Rapports automatiques par joueur, debrief reproductible, coach IA pour le quotidien. "
     "Le support qu'un coach isole n'a jamais eu, dans un calendrier sans intersaison."),
    ("03", "Le roster qui tourne seul",
     "Planning de la semaine, ready check des joueurs dans Discord, progression suivie. "
     "Pour une org comme pour une ecole qui doit montrer ou en sont ses eleves."),
]
prow = Table([[promise_box(*p) for p in promises]], colWidths=[157,157,157])
prow.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
                          ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),4)]))
story.append(prow)

story.append(Paragraph("Les offres", H2))
offers = [
    ["Coach", "99 EUR / mois", "Une equipe",
     "1 roster - revue de demos + anti-strat - Pracc Planner + ready check Discord - rapports joueur et coach"],
    ["Structure", "299 EUR / mois", "Plusieurs equipes (academies, ecoles, orgs)",
     "Tout Coach, rosters illimites - pipeline detection et suivi eleves - rapports direction, parents, sponsors - exports + facturation entreprise"],
    ["Partenaire", "Sur mesure", "Tier 1 / academy, places limitees",
     "Tout Structure - roadmap co-construite - support direct fondateur - donnees isolees, zero reutilisation"],
]
story.append(data_table(
    [[o[0]+"<br/><font size=7 color='#8a9492'>"+o[2]+"</font>", o[1], o[3]] for o in offers],
    ["Offre", "Prix", "Ce que ca inclut"],
    [95, 75, 200], lime_rows=[2]))
story.append(Spacer(1, 6))
story.append(Paragraph("Sans engagement. Demo de 20 minutes pour voir si ca fait gagner du temps. "
                       "contact@fragvalue.com", SMALL))
story.append(PageBreak())

# ════════════════ PARTIE 2 : BUSINESS PLAN ════════════════
story.append(Paragraph("PARTIE 2", H_OVER))
story.append(Paragraph("Business plan B2B", H1))
story.append(rule())

story.append(Paragraph("Postulat", H2))
story.append(Paragraph(
    "FragValue n'est plus un produit B2C. Le client est la structure (org pro, academie, "
    "ecole), pas le joueur. Le produit joueur existant devient une surface d'usage incluse "
    "dans l'abonnement structure, plus un produit vendu separement. On ne vend pas \"mieux "
    "que les outils d'analyse existants\" : on vend les fonctions qu'aucun outil ne couvre.", BODY))

story.append(Paragraph("Ce qu'est une structure CS2 (realite client)", H2))
for li in [
    "<b>Tier 1</b> : 5 joueurs, head coach, assistant, 1 a 2 analystes, staff performance, academy. Multi-jeux. Budget en millions, un outil a 1-2k/mois est invisible s'il fait gagner du temps.",
    "<b>Tier 2 / 3</b> : un coach qui porte aussi l'analyse, le planning et le reporting. Vit du sponsoring, doit prouver son serieux en continu.",
    "<b>Ecoles / academies</b> : plusieurs groupes, une personne porte tous les chapeaux, besoin de prouver la progression aux eleves et aux familles.",
    "<b>Contraintes d'achat</b> : confidentialite des strats (un leak = catastrophe), securite des donnees, support reactif, cycles de decision longs.",
]:
    story.append(Paragraph("- " + li, BODY))

story.append(Paragraph("Offre commerciale (3 SKUs)", H2))
story.append(data_table([
    ["Coach", "1 roster (semi-pro, hub)", "99 / mois (990 / an)"],
    ["Structure", "Academies, ecoles, orgs tier 2/3 multi-equipes", "299 / mois (2 990 / an)"],
    ["Partenaire", "1 a 2 academies tier 1", "Gratuit an 1 contre vitrine + case study"],
], ["Offre", "Cible", "Prix EUR"], [70, 230, 110], lime_rows=[2]))

story.append(Paragraph("Projections (ordres de grandeur sobres)", H2))
story.append(data_table([
    ["An 1", "2 ecoles + 5 structures + 30 Coach", "~5 060 / mois (~60k / an)"],
    ["An 2", "5 ecoles + 15 structures + 100 Coach + 1 partenaire", "~16 000 / mois (~190k / an)"],
], ["Horizon", "Hypothese clients", "MRR / ARR EUR"], [55, 245, 110])
)
story.append(Paragraph("Cout marginal faible : infra existante (Supabase, Vercel, Railway), cout IA plafonne par quotas.", SMALL))

story.append(Paragraph("Go-to-market", H2))
for li in [
    "<b>Vitrine</b> : 1 academy tier 1 FR en partenariat gratuit (angle \"outil construit avec X Academy\").",
    "<b>Ecoles esport FR</b> : vente directe fondateur, demo planner live + rapport de progression.",
    "<b>Ligues ESEA / FACEIT</b> : offre Coach en self-serve, acquisition par le produit joueur gratuit.",
    "<b>Facturation entreprise</b> des le jour 1 : devis, virement, annuel prepaye (les orgs meurent en cours de saison, encaisser d'abord).",
]:
    story.append(Paragraph("- " + li, BODY))

story.append(Paragraph("Risques majeurs", H2))
story.append(data_table([
    ["Confidentialite des strats", "Isolation par structure, clause zero reutilisation, pas d'entrainement IA sur leurs donnees"],
    ["Incumbent analyse (Skybox)", "Ne pas vendre \"meilleure analyse\" : vendre les fonctions non servies (logistique, reporting, detection)"],
    ["Acces demos verrouille (FACEIT/GRID)", "Cibler tier 2/3 + academies ou les demos sont accessibles"],
    ["Solo founder vs promesse B2B", "Peu de clients bien servis, annuel prepaye, transparence"],
], ["Risque", "Mitigation"], [150, 240]))
story.append(PageBreak())

# ════════════════ PARTIE 3 : CARTOGRAPHIE ════════════════
story.append(Paragraph("PARTIE 3", H_OVER))
story.append(Paragraph("Cartographie fonctions vers produits", H1))
story.append(rule())
story.append(Paragraph(
    "Logique additive : pour chaque fonction du quotidien d'une structure qui n'a aujourd'hui "
    "aucun outil dedie (le \"non servi\"), on en fait un produit. On remplit les trous, on ne "
    "coupe pas la gamme. Les lignes en vert sont les trous totaux : c'est la ou personne ne "
    "fait rien, donc la ou une structure accepte de payer.", BODY))

cart = [
    ["1", "Prepa adversaire / anti-strat", "Skybox (tier 1) sinon le coach", "Anti-Strat auto"],
    ["2", "VOD review de sa propre equipe", "Skybox / Noesis (partiel)", "VOD Coordinator"],
    ["3", "Logistique praccs (planning, ready check)", "Rien (Esports Planner mort)", "Pracc Planner (LIVE)"],
    ["4", "Trouver des adversaires de scrim", "PRACC, SCL (gratuits)", "Ne pas refaire"],
    ["5", "Suivi progression d'un joueur", "Leetify / FACEIT (brut)", "Progression roster"],
    ["6", "Detection / evaluation des trials", "Rien (tableurs)", "Pipeline detection"],
    ["7", "Reporting a la direction / GM", "Rien", "Rapport du lundi"],
    ["8", "Reporting aux sponsors", "Rien", "One-pager sponsor"],
    ["9", "Reporting aux parents (ecoles)", "Rien", "Bulletin eleve"],
    ["10", "Memoire tactique / playbook", "Notion, docs perso", "Strat Library (v2)"],
    ["11", "Charge mentale / wellness", "Outils du sport (matures)", "Ne pas entrer"],
    ["12", "Contrats / voyages / admin", "Notion generique", "Ne pas entrer"],
]
story.append(Spacer(1, 2))
story.append(data_table(cart, ["#", "Fonction", "Outil aujourd'hui", "Produit FragValue"],
                        [26, 162, 128, 124], lime_rows=[3,6,7,8,9]))

story.append(Paragraph("Les 5 trous totaux = la gamme a vendre", H2))
story.append(Paragraph(
    "Cinq fonctions n'ont aucun outil aujourd'hui : logistique des praccs (deja construite), "
    "detection / trials, et les trois reportings (direction, sponsors, parents). Les trois "
    "reportings partagent un seul moteur : la donnee est deja dans FragValue (FV Rating, "
    "events du planner, ready check). On construit le generateur une fois, on l'habille "
    "trois fois selon le destinataire.", BODY))

story.append(Paragraph("Ordre de developpement", H2))
story.append(data_table([
    ["1", "Pracc Planner", "Trou total, differenciant, porte d'entree", "LIVE"],
    ["2", "Rapports (moteur + 3 habillages)", "3 trous d'un coup, data deja la, argument de demo", "~2 sem"],
    ["3", "Pipeline detection", "Coeur des ecoles/academies, scout reutilisable", "~1 sem"],
    ["4", "Anti-Strat pousse", "Besoin le plus prouve, mais frontal vs Skybox", "Existe"],
    ["5", "VOD Coordinator", "Confort, pas un declencheur d'achat", "Page live"],
], ["Rang", "Produit", "Pourquoi ce rang", "Etat"], [34, 130, 196, 60], lime_rows=[1]))

story.append(KeepTogether([
    Paragraph("Principe directeur", H2),
    Paragraph(
        "Une structure n'achete pas une fonctionnalite, elle achete une fonction de son "
        "organigramme qu'elle n'arrive pas a couvrir. FragValue ne remplace pas le coach ou "
        "l'analyste : il couvre la part de leur travail que personne ne fait, faute de temps ou "
        "de budget. C'est ca qu'on vend, fonction par fonction.", BODY),
    Spacer(1, 6),
    rule(color=LINE, w=0.5, space=6),
    Paragraph(
        "Prochaine etape : valider en entretien lesquels de ces 5 trous font le plus mal, avant "
        "de construire les rangs 2 et 3. Ne pas developper dans le vide.", SMALL),
]))

Dossier(OUT).build(story)
print("OK ->", OUT)

# -*- coding: utf-8 -*-
"""Genere docs/fragvalue-plan-action.pdf — plan d'action pivot B2B structures."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
    Spacer, Table, TableStyle, PageBreak, HRFlowable, KeepTogether)

OUT = "fragvalue-plan-action.pdf"
LIME=colors.HexColor("#8FCB1F"); LIME_BAR=colors.HexColor("#b8ff57")
INK=colors.HexColor("#0d0f0f"); GREY=colors.HexColor("#55605f")
GREY_L=colors.HexColor("#8a9492"); PANEL=colors.HexColor("#f4f6f3")
PANEL_LIME=colors.HexColor("#f2fae4"); LINE=colors.HexColor("#dde2dd"); WHITE=colors.white
ss=getSampleStyleSheet()
def S(n,**k):
    base=k.pop("parent",ss["Normal"]); return ParagraphStyle(n,parent=base,**k)
OVER=S("o",fontName="Helvetica-Bold",fontSize=8,textColor=LIME,leading=12,spaceAfter=3)
H1=S("h1",fontName="Helvetica-Bold",fontSize=22,textColor=INK,leading=25,spaceAfter=4)
H2=S("h2",fontName="Helvetica-Bold",fontSize=14,textColor=INK,leading=18,spaceBefore=15,spaceAfter=6)
PH=S("ph",fontName="Helvetica-Bold",fontSize=12.5,textColor=INK,leading=16,spaceBefore=4,spaceAfter=2)
BODY=S("b",fontName="Helvetica",fontSize=9.7,textColor=INK,leading=14.5,alignment=TA_JUSTIFY,spaceAfter=6)
SMALL=S("s",fontName="Helvetica",fontSize=8,textColor=GREY_L,leading=11)
CELL=S("c",fontName="Helvetica",fontSize=8.4,textColor=INK,leading=11.5)
CELLB=S("cb",parent=CELL,fontName="Helvetica-Bold")
CELLH=S("ch",fontName="Helvetica-Bold",fontSize=8.4,textColor=WHITE,leading=11.5)

def rule(color=LIME_BAR,w=1.4,sp=8): return HRFlowable(width="100%",thickness=w,color=color,spaceBefore=sp,spaceAfter=sp,lineCap="round")

def tbl(rows,header,cw,lime_rows=None):
    lime_rows=lime_rows or []
    data=[[Paragraph(c,CELLH) for c in header]]+[[Paragraph(c,CELL) for c in r] for r in rows]
    t=Table(data,colWidths=cw,repeatRows=1)
    st=[("BACKGROUND",(0,0),(-1,0),INK),("BOX",(0,0),(-1,-1),0.5,LINE),
        ("LINEBELOW",(0,0),(-1,-1),0.4,LINE),("LINEAFTER",(0,0),(-2,-1),0.4,LINE),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),
        ("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),5),
        ("BOTTOMPADDING",(0,0),(-1,-1),5),("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE,PANEL])]
    for ri in lime_rows: st.append(("BACKGROUND",(0,ri),(-1,ri),PANEL_LIME))
    t.setStyle(TableStyle(st)); return t

def phase(title, sub, actions, livrable, gate=None):
    blocks=[Paragraph(title,PH), Paragraph(sub,SMALL), Spacer(1,4)]
    for a in actions: blocks.append(Paragraph("- "+a, BODY))
    blocks.append(Paragraph("<b>Livrable :</b> "+livrable, S("lv",parent=BODY,textColor=GREY,spaceAfter=2)))
    if gate: blocks.append(Paragraph("<b>Gate :</b> "+gate, S("gt",parent=BODY,textColor=colors.HexColor("#3f6b00"),spaceAfter=2)))
    blocks.append(rule(color=LINE,w=0.5,sp=8))
    return KeepTogether(blocks)

class Doc(BaseDocTemplate):
    def __init__(s,fn,**k):
        super().__init__(fn,pagesize=A4,leftMargin=20*mm,rightMargin=20*mm,topMargin=18*mm,bottomMargin=16*mm,**k)
        s.addPageTemplates([PageTemplate(id="a",frames=[Frame(s.leftMargin,s.bottomMargin,s.width,s.height)],onPage=s._f)])
    def _f(s,c,d):
        c.saveState(); c.setStrokeColor(LINE); c.setLineWidth(0.5)
        c.line(20*mm,12*mm,A4[0]-20*mm,12*mm); c.setFont("Helvetica",7.5); c.setFillColor(GREY_L)
        c.drawString(20*mm,8.5*mm,"FragValue  -  Plan d'action  -  Confidentiel")
        c.drawRightString(A4[0]-20*mm,8.5*mm,"p. %d"%d.page); c.restoreState()

st=[]
# COUVERTURE
st.append(Spacer(1,150))
st.append(Paragraph("FRAG<font color='#8FCB1F'>VALUE</font>",S("lg",fontName="Helvetica-Bold",fontSize=38,textColor=INK,alignment=TA_CENTER,leading=42)))
st.append(Spacer(1,8))
st.append(Paragraph("PLAN D'ACTION",S("cv",fontName="Helvetica-Bold",fontSize=15,textColor=LIME,alignment=TA_CENTER,leading=20)))
st.append(Paragraph("Pivot B2B structures esport CS2",S("cs",fontName="Helvetica-Oblique",fontSize=12,textColor=GREY,alignment=TA_CENTER,leading=18)))
st.append(Spacer(1,20)); st.append(HRFlowable(width=55*mm,thickness=2,color=LIME_BAR,hAlign="CENTER"))
st.append(Spacer(1,180))
st.append(Paragraph("Juin 2026  -  10 semaines  -  valider avant de construire",S("cf",fontName="Helvetica",fontSize=8.5,textColor=GREY_L,alignment=TA_CENTER)))
st.append(PageBreak())

# ETAT DES LIEUX
st.append(Paragraph("OU ON EN EST",OVER)); st.append(Paragraph("Etat des lieux",H1)); st.append(rule())
st.append(Paragraph("Acquis (deja en place)",H2))
st.append(tbl([
    ["Positionnement","Pivot B2C -> B2B structures decide. On vend les fonctions qu'aucun outil ne couvre."],
    ["Produit live","Pracc Planner fonctionnel + notifications Discord (ready check). Page de vente /structures.html."],
    ["Supports","Dossier PDF (one-pager + business plan + cartographie), guide d'entretien Mom Test."],
    ["Marche","Besoins valides par recherche (16 claims) : revue de demos/anti-strat = pain #1, charge du coach = pain #3."],
    ["Technique","FACEIT Downloads API ACCORDE le 12/06. Ingestion auto des demos debloquee apres ~3 mois."],
], ["Volet","Statut"], [80, 310]))
st.append(Paragraph("Le principe directeur",H2))
st.append(Paragraph("On ne construit RIEN de neuf avant d'avoir valide en entretien quel trou fait le plus "
    "mal et si le prix tient. La recherche prouve les besoins ; les entretiens prouvent qu'on PAIE pour les "
    "resoudre. L'ordre est : debloquer la techno qui sert le besoin deja prouve (analyse/anti-strat), vendre, "
    "ecouter, puis construire le rang suivant.", BODY))
st.append(PageBreak())

# LES PHASES
st.append(Paragraph("LE PLAN",OVER)); st.append(Paragraph("4 phases sur 10 semaines",H1)); st.append(rule())

st.append(phase("Phase 0 - Debloquer et armer", "Cette semaine",
 ["Poser FACEIT_DOWNLOADS_TOKEN dans Vercel + verifier la chaine d'ingestion. L'analyse et l'anti-strat "
  "(le besoin #1 prouve) tournent enfin en auto : c'est le meilleur argument de vente, donc priorite absolue.",
  "Poster la question webhook/polling sur le Discord FACEIT Developers (question deja redigee).",
  "Finaliser le mail de prise de contact + attacher le dossier PDF.",
  "Lister 15 cibles : ecoles esport FR (Gaming Campus, PHG, Helios...) + 5 coachs d'orgs ESEA, avec l'interlocuteur nominatif par structure."],
 "Chaine FACEIT verte, dossier + mail prets, liste de 15 cibles."))

st.append(phase("Phase 1 - Valider le marche", "Semaines 1 a 3",
 ["Decrocher et mener 10 entretiens decouverte avec le guide Mom Test. Zero pitch : faire parler de leur "
  "derniere semaine, de ce qui les a enerves, de ce qu'ils paient deja.",
  "Combler les 4 trous de la recherche : qui decide l'achat, le budget reel, les pains praccs (le Pracc Planner "
  "repose encore sur une hypothese), les objections (mefiance IA, confidentialite, perennite solo founder).",
  "Tester le prix 299 EUR/mois en direct."],
 "10 comptes-rendus d'entretien remplis (tableau du guide).",
 "Decision go/no-go : quel produit construire en rang 2, a quel prix. Si moins de 2/10 mordent au prix, on revoit l'offre AVANT de coder."))

st.append(phase("Phase 2 - Construire le bon produit", "Semaines 4 a 7",
 ["Construire UNIQUEMENT ce que les entretiens ont valide. Hypothese forte : le moteur de rapports "
  "(3 trous d'un coup : direction, sponsors, parents) car la data est deja la. Bascule possible vers le "
  "pipeline detection si les ecoles dominent les signaux d'achat.",
  "Pendant ce temps, l'ingestion FACEIT auto (debloquee en phase 0) alimente deja l'analyse et l'anti-strat sans effort.",
  "Chaque merge sur main attend ton OK explicite. Build sur branche preview, tu valides."],
 "Le produit rang 2 live en beta, montre aux structures interviewees.",
 "Ne pas attaquer l'analyse de Skybox de front : on vend les fonctions non servies."))

st.append(phase("Phase 3 - Premiers revenus + vitrine", "Semaines 8 a 10",
 ["Convertir 2 pilotes payants en annuel prepaye (les orgs meurent en cours de saison : encaisser d'abord).",
  "Signer 1 partenariat academy tier 1 (gratuit an 1 contre logo + case study + 2 interviews staff/mois).",
  "Mettre en place la facturation entreprise : devis, virement, mention SIREN."],
 "2 pilotes payants + 1 partenariat vitrine signe.",
 "Si 0 conversion a S10 : retour phase 1, l'offre ou la cible est a revoir, pas le produit."))
st.append(PageBreak())

# METRIQUES + GARDE-FOUS
st.append(Paragraph("PILOTAGE",OVER)); st.append(Paragraph("Metriques et garde-fous",H1)); st.append(rule())
st.append(Paragraph("Metriques de succes par phase",H2))
st.append(tbl([
    ["0","Chaine FACEIT verte, 15 cibles listees","fin de semaine"],
    ["1","10 entretiens menes, >=2 interets concrets au prix 299","S3"],
    ["2","Produit rang 2 en beta, montre aux interviewes","S7"],
    ["3","2 pilotes payants + 1 partenariat academy","S10"],
], ["Phase","Cible mesurable","Echeance"], [40, 280, 70]))

st.append(Paragraph("Garde-fous (ce qu'on ne fait PAS)",H2))
for g in [
    "<b>Pas de build avant validation</b> : aucun nouveau produit code avant que les entretiens prouvent la demande.",
    "<b>Pas de merge sur main sans ton OK explicite</b> : tout va sur preview, tu decides du go-live.",
    "<b>Supports strategie/vente en PDF d'abord</b>, pas en page HTML.",
    "<b>Pas de B2C</b> : le produit joueur reste un funnel, pas un produit vendu.",
    "<b>Pas de front contre Skybox</b> : on vend les fonctions non servies (logistique, reporting, detection).",
    "<b>Annuel prepaye</b> pour les orgs : encaisser avant la mort de saison.",
]:
    st.append(Paragraph("- "+g, BODY))

st.append(Paragraph("Risques a surveiller",H2))
st.append(tbl([
    ["Entretiens difficiles a decrocher","Activer le reseau FR esport, le Discord, les contacts academy en premier"],
    ["Pain praccs non confirme","Si le planner ne resonne pas, pivoter le pitch sur analyse + reporting (besoins prouves)"],
    ["Confidentialite des strats","Clause zero reutilisation + isolation par structure, prete avant le 1er pilote"],
    ["Temps solo founder","Sequencer strictement : une phase a la fois, pas de build premature"],
], ["Risque","Parade"], [165, 225]))
st.append(Spacer(1,8)); st.append(rule(color=LINE,w=0.5,sp=6))
st.append(Paragraph("Prochaine action immediate : poser le token FACEIT dans Vercel, puis decrocher les "
    "3 premiers entretiens. Le reste du plan en decoule.", SMALL))

Doc(OUT).build(st)
print("OK ->", OUT)

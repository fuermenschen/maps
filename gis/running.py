"""Simple OSM foot-access and surface classes for running view."""

from bicycle import PAVED, UNPAVED

ALLOWED = {"yes", "designated", "official", "permissive"}
BLOCKED = {"no", "private", "destination", "customers", "delivery", "permit",
           "forestry", "agricultural", "use_sidepath"}
FOOT_DEFAULT_YES = {"footway", "pedestrian", "path", "track", "bridleway", "steps", "platform",
                    "residential", "living_street", "service", "unclassified", "primary", "primary_link",
                    "secondary", "secondary_link", "tertiary", "tertiary_link"}


def permission(tags, side, default):
    for key in (f"foot:{side}", "foot", f"access:{side}", "access"):
        if tags.get(key + ":conditional"):
            return "review"
        value = tags.get(key)
        if value:
            if key.split(":", 1)[0] == "access" and value in {"designated", "official", "dismount", "use_sidepath"}:
                return "review"
            return "yes" if value in ALLOWED else "no" if value in BLOCKED else "review"
    return default


def assess(tags):
    highway = tags.get("highway", "")
    surface = tags.get("surface", "")
    surface_class = "paved" if surface in PAVED else "unpaved" if surface in UNPAVED else "unknown"
    if highway in {"motorway", "motorway_link", "construction", "proposed"} or tags.get("motorroad") == "yes":
        return "no", surface_class
    default = "yes" if highway in FOOT_DEFAULT_YES else "review"
    if highway in {"trunk", "trunk_link", "cycleway"}:
        default = "review"
    directions = [permission(tags, side, default) for side in ("forward", "backward")]
    if directions == ["no", "no"]:
        return "no", surface_class
    return ("yes" if directions == ["yes", "yes"] else "review"), surface_class


def check():
    assert assess({"highway": "footway", "surface": "asphalt"}) == ("yes", "paved")
    assert assess({"highway": "steps"}) == ("yes", "unknown")
    assert assess({"highway": "path", "surface": "gravel"}) == ("yes", "unpaved")
    assert assess({"highway": "footway", "foot": "no"})[0] == "no"
    assert assess({"highway": "footway", "access": "no", "foot": "yes"})[0] == "yes"
    assert assess({"highway": "footway", "access": "forestry"})[0] == "no"
    assert assess({"highway": "footway", "access": "forestry", "foot": "yes"})[0] == "yes"
    assert assess({"highway": "footway", "access": "designated"})[0] == "review"
    assert assess({"highway": "footway", "foot": "designated"})[0] == "yes"
    assert assess({"highway": "footway", "foot:conditional": "no @ (Su)"})[0] == "review"
    assert assess({"highway": "trunk"})[0] == "review"
    assert assess({"highway": "motorway"})[0] == "no"

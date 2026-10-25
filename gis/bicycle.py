"""Small Swiss bicycle-access profile. OSM defaults, not a legal-access certificate."""

PAVED = {"asphalt", "concrete", "concrete:plates", "concrete:lanes", "paved",
         "paving_stones", "sett", "cobblestone", "unhewn_cobblestone"}
UNPAVED = {"unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "ground",
           "dirt", "earth", "grass", "sand", "mud", "woodchips", "grass_paver"}
ORDINARY = {"primary", "primary_link", "secondary", "secondary_link", "tertiary",
            "tertiary_link", "unclassified", "residential", "living_street", "service"}
ALLOWED = {"yes", "designated", "official", "permissive"}
BLOCKED = {"no", "private", "destination", "customers", "delivery", "forestry",
           "agricultural", "permit", "dismount", "use_sidepath"}
TAG_KEYS = {
    "highway", "name", "ref", "service", "surface", "smoothness", "tracktype", "incline",
    "step_count", "ramp", "handrail", "conveying", "barrier", "locked", "motorroad",
    "bridge", "tunnel", "layer", "junction", "lit",
}
TAG_PREFIXES = ("access", "bicycle", "vehicle", "motor_vehicle", "motorcar", "foot",
                "motorcycle", "motorbike", "agricultural", "forestry",
                "oneway", "cycleway", "step", "ramp", "handrail")


def source_tags(tags):
    return {key: value for key, value in tags.items()
            if key in TAG_KEYS or key in TAG_PREFIXES or any(key.startswith(prefix + ":") for prefix in TAG_PREFIXES)}


def permission(tags, side, default="review"):
    # Most-specific applicable key wins, including exceptions to generic conditionals.
    for key in (f"bicycle:{side}", "bicycle", f"vehicle:{side}", "vehicle", f"access:{side}", "access"):
        if tags.get(key + ":conditional"):
            return "review", f"{key}:conditional={tags[key + ':conditional']}"
        value = tags.get(key)
        if value:
            if key.split(":", 1)[0] == "access" and value in {"designated", "official", "dismount", "use_sidepath"}:
                return "review", f"{key}={value} needs a specific travel mode"
            if value == "discouraged":
                return "review", f"{key}=discouraged"
            return ("yes" if value in ALLOWED else "no" if value in BLOCKED else "review"), f"{key}={value}"
    return default, "Zugang nach Strassentyp" if default != "review" else "Zugang unklar"


def bicycle_direction(tags):
    if "oneway:bicycle:conditional" in tags:
        return "review"
    if "oneway:bicycle" in tags:
        value = tags["oneway:bicycle"]
    else:
        if "oneway:conditional" in tags:
            return "review"
        value = tags.get("oneway", "yes" if tags.get("junction") == "roundabout" else "no")
        opposite = "backward" if value in {"yes", "1", "true"} else "forward" if value == "-1" else None
        if opposite and tags.get(f"bicycle:{opposite}:conditional"):
            return "review"
        if opposite and tags.get(f"bicycle:{opposite}") in ALLOWED:
            return "both"
        if value in {"yes", "1", "true", "-1"} and any(
            tags.get(k, "").startswith("opposite") for k in ("cycleway", "cycleway:left", "cycleway:right", "cycleway:both")
        ):
            return "both"
    return {"yes": "forward", "1": "forward", "true": "forward", "-1": "reverse",
            "no": "both", "0": "both", "false": "both"}.get(value, "review")


def assess(tags):
    highway = tags.get("highway", "")
    if highway in {"motorway", "motorway_link"} or tags.get("motorroad") == "yes":
        return "no", "none", "Autobahn/Autostrasse gemäss OSM-Markierung"
    if highway == "steps":
        return "no", "none", "Treppe – nicht als Rennvelo-Abschnitt gewertet"
    if highway in {"construction", "proposed"}:
        return "no", "none", "Bau oder Planung – kein bestehender Fahrweg"
    default = "yes" if highway in ORDINARY | {"cycleway", "path", "track"} else "no" if highway in {"footway", "pedestrian", "bridleway"} else "review"
    if highway in {"trunk", "trunk_link"}:
        default = "review"
    forward, why_forward = permission(tags, "forward", default)
    backward, why_backward = permission(tags, "backward", default)
    direction = bicycle_direction(tags)
    if direction == "forward":
        backward = "no"
    elif direction == "reverse":
        forward = "no"
    elif direction == "review":
        if forward != "no": forward = "review"
        if backward != "no": backward = "review"
    allowed = "both" if forward == backward == "yes" else "forward" if forward == "yes" else "reverse" if backward == "yes" else "none"
    if forward == backward == "no":
        return "no", "none", why_forward + "; " + why_backward
    surface = tags.get("surface", "")
    if surface in UNPAVED or tags.get("smoothness") in {"very_bad", "horrible", "very_horrible", "impassable"}:
        return "no", "none", "Unbefestigt oder für Rennvelo ungeeignet"
    reasons = []
    if surface not in PAVED:
        reasons.append("Belag nicht ausreichend erfasst")
    if highway in {"trunk", "trunk_link"} and not any(
        tags.get(key) in ALLOWED for key in ("bicycle", "bicycle:forward", "bicycle:backward")
    ):
        reasons.append("Velofreigabe bei highway=trunk lokal prüfen")
    if "review" in (forward, backward):
        reasons.append("Zugang oder Fahrtrichtung prüfen: " + why_forward + "; " + why_backward)
    if tags.get("barrier") not in {None, "no", "bollard", "entrance"}:
        reasons.append("Hindernis prüfen")
    return ("review" if reasons else "yes"), allowed, "; ".join(reasons)


def obstacle(tags):
    forward, reason = permission(tags, "forward", "yes")
    backward, other = permission(tags, "backward", "yes")
    if forward == backward == "no":
        return "no", "Sperre: " + reason
    barrier = tags.get("barrier")
    if barrier in {"wall", "fence", "stile", "turnstile", "kissing_gate", "block"}:
        return "no", "Nicht durchfahrbares Hindernis: " + barrier
    if barrier not in {None, "no", "bollard", "entrance"} or tags.get("locked") == "yes" or "review" in (forward, backward) or forward != backward:
        return "review", "Sperre/Hindernis prüfen: " + (barrier or reason + "; " + other)
    return "yes", ""


def check():
    paved = {"highway": "residential", "surface": "asphalt"}
    assert assess(paved)[:2] == ("yes", "both")
    assert assess(paved | {"motor_vehicle": "no"})[0] == "yes"
    assert assess(paved | {"vehicle": "no", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"access": "no", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"oneway": "yes", "oneway:bicycle": "no"})[:2] == ("yes", "both")
    assert assess(paved | {"oneway": "-1"})[1] == "reverse"
    assert assess(paved | {"oneway": "yes", "cycleway": "opposite_lane"})[1] == "both"
    assert assess(paved | {"oneway": "yes", "bicycle:backward": "yes"})[1] == "both"
    assert assess(paved | {"oneway": "yes", "bicycle:backward:conditional": "yes @ (Su)"})[0] == "review"
    assert assess(paved | {"surface": "cobblestone"})[0] == "yes"
    assert assess(paved | {"bicycle": "discouraged"})[0] == "review"
    assert assess(paved | {"highway": "trunk"})[0] == "review"
    assert assess(paved | {"highway": "trunk", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"highway": "trunk", "motorroad": "yes"})[0] == "no"
    assert assess(paved | {"highway": "steps"})[0] == "no"
    assert assess(paved | {"highway": "motorway"})[0] == "no"
    assert assess(paved | {"highway": "footway"})[0] == "no"
    assert assess(paved | {"highway": "footway", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"bicycle": "destination"})[0] == "no"
    assert assess(paved | {"bicycle:conditional": "no @ (Su)"})[0] == "review"
    assert assess(paved | {"access": "forestry"})[0] == "no"
    assert assess(paved | {"access": "forestry", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"motor_vehicle": "forestry"})[0] == "yes"
    assert assess(paved | {"bicycle": "yes", "motor_vehicle": "forestry",
                           "motorcar": "no", "motorcycle": "no"})[:2] == ("yes", "both")
    assert assess(paved | {"vehicle": "forestry"})[0] == "no"
    assert assess(paved | {"access": "designated"})[0] == "review"
    assert assess(paved | {"access": "use_sidepath"})[0] == "review"
    assert assess(paved | {"bicycle": "use_sidepath"})[0] == "no"
    assert assess(paved | {"bicycle": "designated"})[0] == "yes"
    assert assess(paved | {"access": "official"})[0] == "review"
    assert assess(paved | {"bicycle": "official"})[0] == "yes"
    assert assess(paved | {"access:conditional": "no @ (Su)", "bicycle": "yes"})[0] == "yes"
    assert assess(paved | {"bicycle:forward": "no"})[1] == "reverse"
    assert assess({"highway": "residential"})[0] == "review"
    assert obstacle({"barrier": "bollard", "motor_vehicle": "no"})[0] == "yes"
    assert obstacle({"barrier": "gate", "bicycle": "yes"})[0] == "review"
    assert obstacle({"bicycle": "no"})[0] == "no"
    assert source_tags({"highway": "steps", "surface": "asphalt", "step_count": "4",
                        "bicycle": "yes", "motor_vehicle": "forestry", "motorcar": "no",
                        "motorcycle": "no", "bicycle:conditional": "no @ (Su)", "unrelated": "x"}) == {
                            "highway": "steps", "surface": "asphalt", "step_count": "4",
                            "bicycle": "yes", "motor_vehicle": "forestry", "motorcar": "no",
                            "motorcycle": "no",
                            "bicycle:conditional": "no @ (Su)"}
    print("Bicycle-access checks passed")


if __name__ == "__main__":
    check()

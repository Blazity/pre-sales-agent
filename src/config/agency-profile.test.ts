import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildAgencyIdentityPrompt,
  defaultAgencyProfile,
  loadAgencyProfile,
} from "./agency-profile.js";

describe("agency profile", () => {
  it("loads the default public starter profile", () => {
    const profile = loadAgencyProfile({});

    assert.equal(profile.name, "Example Digital Studio");
    assert.equal(profile.brand.accentColor, "#F97316");
    assert.ok(profile.voice.forbiddenPhrases.includes("cutting-edge"));
    assert.equal(profile.links.website, "https://example.com");
  });

  it("deep-merges JSON profile overrides from AGENCY_PROFILE_PATH", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agency-profile-"));
    const profilePath = path.join(dir, "agency.json");
    fs.writeFileSync(profilePath, JSON.stringify({
      name: "Northstar Studio",
      brand: { accentColor: "#00AA88" },
      links: { website: "https://northstar.example" },
      voice: { forbiddenPhrases: ["world-class"] },
    }));

    const profile = loadAgencyProfile({ AGENCY_PROFILE_PATH: profilePath });

    assert.equal(profile.name, "Northstar Studio");
    assert.equal(profile.brand.accentColor, "#00AA88");
    assert.equal(profile.brand.textColor, defaultAgencyProfile.brand.textColor);
    assert.deepEqual(profile.voice.forbiddenPhrases, ["world-class"]);
    assert.equal(profile.links.website, "https://northstar.example");
  });

  it("formats an agency identity prompt without private brand names", () => {
    const prompt = buildAgencyIdentityPrompt(defaultAgencyProfile);
    const privateBrand = ["Bla", "zity"].join("");

    assert.match(prompt, /Example Digital Studio/);
    assert.match(prompt, /A senior product engineering team/);
    assert.match(prompt, /Challenger-style approach/);
    assert.match(prompt, /Writing rules/);
    assert.doesNotMatch(prompt, new RegExp(privateBrand, "i"));
    assert.match(prompt, /https:\/\/example\.com/);
  });
});

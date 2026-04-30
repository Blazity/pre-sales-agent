import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultAgencyProfile, type AgencyProfile } from "../config/agency-profile.js";
import {
  ESTIMATION_TEMPLATE_HEADERS,
  buildEstimationSheetTemplatePlan,
  buildOfferTemplatePlan,
} from "./google-templates.js";

describe("Google template builders", () => {
  it("builds an offer template with required cover placeholders and generic starter branding", () => {
    const plan = buildOfferTemplatePlan(defaultAgencyProfile);
    const privateBrand = ["Bla", "zity"].join("");

    assert.equal(plan.title, "Example Digital Studio Offer Template");
    assert.deepEqual(plan.placeholders, ["{{CLIENT_NAME}}", "{{PROJECT_NAME}}", "{{DATE}}"]);
    assert.match(plan.coverText, /{{CLIENT_NAME}} & EXAMPLE DIGITAL STUDIO/);
    assert.match(plan.coverText, /Proposal/);
    assert.match(plan.coverText, /{{PROJECT_NAME}}/);
    assert.match(plan.coverText, /{{DATE}}/);
    assert.doesNotMatch(plan.coverText, new RegExp(privateBrand, "i"));
    assert.ok(plan.requests.some((request) => request.insertPageBreak));
  });

  it("drives offer colors and agency label from the agency profile", () => {
    const profile: AgencyProfile = {
      ...defaultAgencyProfile,
      name: "Northstar Studio",
      brand: {
        ...defaultAgencyProfile.brand,
        accentColor: "#00AA88",
        textColor: "#101820",
      },
    };

    const plan = buildOfferTemplatePlan(profile);
    const serialized = JSON.stringify(plan.requests);

    assert.equal(plan.title, "Northstar Studio Offer Template");
    assert.match(plan.coverText, /{{CLIENT_NAME}} & NORTHSTAR STUDIO/);
    assert.match(serialized, /0\.666/); // #00AA88 green channel
    assert.match(serialized, /0\.062/); // #101820 red channel
  });

  it("builds a sheet template aligned with the estimation writer contract", () => {
    const plan = buildEstimationSheetTemplatePlan(defaultAgencyProfile, 12345);

    assert.equal(plan.title, "Example Digital Studio Estimation Template");
    assert.deepEqual(ESTIMATION_TEMPLATE_HEADERS, [
      "Module",
      "Action Item",
      "Effort (MD)",
      "Risk-adjusted Effort (MD)",
      "Type",
      "Optional",
      "Risk",
      "Assumptions",
      "Figma Link",
    ]);
    assert.deepEqual(plan.values[0], ESTIMATION_TEMPLATE_HEADERS);
    assert.equal(plan.values[1].length, ESTIMATION_TEMPLATE_HEADERS.length);
    assert.match(plan.values[1][2], /man-days/);
    assert.match(plan.values[1][3], /risk buffer/);
    assert.match(plan.values[1][5], /TRUE/);
  });

  it("adds frozen rows, dropdown validations, and brand formatting to the sheet template", () => {
    const plan = buildEstimationSheetTemplatePlan(defaultAgencyProfile, 987);
    const serialized = JSON.stringify(plan.requests);

    assert.match(serialized, /frozenRowCount/);
    assert.match(serialized, /ONE_OF_LIST/);
    assert.match(serialized, /Frontend/);
    assert.match(serialized, /Backend/);
    assert.match(serialized, /Design/);
    assert.match(serialized, /QA/);
    assert.match(serialized, /DevOps/);
    assert.match(serialized, /Low/);
    assert.match(serialized, /Medium/);
    assert.match(serialized, /High/);
    assert.match(serialized, /BOOLEAN/);
    assert.match(serialized, /0\.976/); // #F97316 red channel
  });
});

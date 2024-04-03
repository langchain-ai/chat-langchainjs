const langgraphQuestions = ["06bb6aa0-5282-4630-8c83-08fb4ecdab59"];

const datedQuestions = [
  "edf05a99-6e8f-4340-91a4-13918bd95fa5",
  "aaaf00d9-45d8-4f0a-be9b-4724810a9aa4",
];

const questionableRunIds = [
  "50d1f9b8-332b-44a8-862b-a6b842b60828",
  "fa287cd0-3152-4da2-9dbe-54d20b769b49",
  "5833d920-ad0b-4080-b564-1739415409a6",
  "dfac0e9f-a19d-48d6-a41f-f793acea9102",
  "73294f70-86dc-44b1-b207-22478e18c85e",
  "42197f3d-678e-401b-a5c6-9b80ff5c0dec",
  "48efe219-0306-4249-952b-3ba5d5b7fb25",
  "735a9b31-161e-4385-af56-2f8027c358e0",
];

const badRunIds = [
  "0fa67da7-7673-4ab1-9291-2570de2c3f69",
  "cfeb2acd-b18e-4aaa-b666-492fd8987b21",
  "5c669f5e-b3c6-40a4-a5e3-fd1d431f57f6",
  "acc0e93a-e152-4be1-b48c-a177b943915d",
  "493802bd-43a2-41cd-b07e-980299527b12",
  "ba0e458a-320a-4572-afbd-33d319c7b412",
  "67731bb8-3614-4a2e-b452-3f1643947f16",
  "b41d09ef-a305-421f-93bd-f37063a9e4ca",
  "2a35424f-0f57-49fd-b06d-738f7b678051",
  "08ca8437-297a-4510-8593-67828e220d70",
  "4b329469-296b-4a25-85c0-ecb294b92520",
  "b19cda44-5421-4b41-a4b8-192a5b9ae96a",
  "9438c0d5-2c7e-4905-b7dc-1efe20938cf7",
  "6ad30fdd-0523-4e44-8924-7a6a1fed718a",
];

export const BLACKLISTED_RUN_IDS = badRunIds
  .concat(questionableRunIds)
  .concat(datedQuestions)
  .concat(langgraphQuestions);

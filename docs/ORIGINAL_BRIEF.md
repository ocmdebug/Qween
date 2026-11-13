I want to create html that can use GLM with the open router key i placed. 
the main point of the page is to Recognice text from a photo. and be able to make a trnascirpt of it,  meaning that the page shoulld have a palce to drop the photo as a file, png, jpg etc, pdf, etc.
Then the AI will trnascibe what they see in the photo and give it back

The photo of the eample, that we have in the folder shows the type of doucment that we are going to focus on mainly to have a bes strtucture of them so we can give to the ai a more detailed strcuture.
We focus on using:
Qwen3 VL 8B Instruct
Qwen3 VL 30B A3B Instruct
Qwen3 VL 235B A22B Instruct

For the page i dont want Funny colorus etc i would like to get a simple stile black grey white stile page Formal. You can use the glass  buttons for example i saw them the other day to give  a good style, letme know what you thnk and if you have a question, please make a  documentation please 

outupt json format:
{
  "f_name": "Jan",
  "l_name": "Testowy",
  "nationality": "Polska",
  "pesel": "TEST-DOKUMENT-123",
  "noPesel": true,
  "birthdate": "1990-01-01",
  "patient_street_name": "Testowa",
  "patient_house_number": "1",
  "patient_unit_id": "12",
  "zip_code": "00-000",
  "city": "Miejscowość testowa",
  "email": "jan.testowy@example.com",
  "phone": "+48123456789",
  "name_company": "Firma testowa",
  "nip": "",
  "regon": "000000000",
  "country_company": "Polska",
  "address_company": "Firmowa 2",
  "zip_code_company": "00-001",
  "city_company": "Miasto testowe",
  "noNip": true,
  "name_position": "Stanowisko testowe",
  "description_position": "Opis stanowiska",
  "harmful_factors": "Przykładowe czynniki"
}
